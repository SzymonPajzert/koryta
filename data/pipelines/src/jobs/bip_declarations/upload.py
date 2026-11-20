"""Send the candidacies and the crops to the site: `/api/ingest/declarations`.

The contract is the site's (`frontend/shared/declarations.ts`,
`declarationIngestSchema`): a candidacy is its `BipPersonOfInterest.key` with
the koryta pages it was matched to, an extract one crop - a file and a page -
with the candidacies it serves. Both have fixed ids, so sending one again
overwrites it rather than doubling it, and the site keeps a crop's pictures
once somebody has answered it.

Only candidacies with a page on the site go: the contract has no room for the
others (`kids` takes at least one), and an extract goes only for the
candidacies of those. Of a council's file, a page goes for a candidacy only
when the name read on it is the candidate's: one page of such a file holds a
stranger's declaration more often than not.

What was sent is kept in `bip_decl_sent` as a hash, so a run sends what is new
or changed since the last: a candidacy whose search moved on, a crop cut again.

`--public-post` sends only the candidacies whose page holds a paid post, current
or ended, at a public company (`BipPersonOfInterest.public_post`), and the crops
that serve them: the site publishes a page from its declaration only then
(`frontend/server/utils/publicPosts.ts`), so a crop of anybody else would be
read for a page that never goes up.
After the upload the job calls `/api/declarations/sweep`, which compares the
readings settled since with their pages.

`--employment` sends instead the bands readers read declared posts off
(`/api/ingest/declarations/employment`, `employmentIngestSchema` in
`frontend/shared/declarationEmployment.ts`): for each declaration, its header
and its employer's line as `cut-employment` cut them, with the machine's
suggestions for a printed line. It goes for the pages without a paid public
post, the other side of `--public-post`, once readers agreed on the
declaration's birth date and the site matched it to that one page
(`employment_records`). A person's newest declaration is read first; the older
ones go too, put off (`later`). The bands are kept by their date page's id, so
sending them again overwrites them, and a band readers answered keeps its
pictures; `bip_decl_sent` keeps them as kind `employment`.
"""

from __future__ import annotations

import base64
import hashlib
import json
import re
import time
from collections import Counter, defaultdict
from collections.abc import Callable, Iterable, Iterator, Mapping
from dataclasses import dataclass, field
from datetime import date
from typing import Any, Protocol

import requests

from jobs.bip_declarations.employment import EMPLOYMENT_CUT_VERSION
from jobs.bip_declarations.reading import birth_window, in_windows, name_matches
from jobs.bip_declarations.suggest import BodyIndex, Roles, suggest
from scrapers.stores import (
    BipDeclarationStore,
    DeclarationBandRow,
    DeclarationCropRow,
    DeclarationCutRow,
    DeclarationLink,
    PersonRow,
    SentRow,
)
from stores.bip_declarations import png_hash
from stores.koryta_login import TokenError, TokenSource

#: Where the site is. The merge of the declarations pages lands on autopush
#: first, and autopush writes to production's Firestore (as for people_import).
DEFAULT_ENDPOINT = "https://autopush.koryta.pl"
INGEST = "/api/ingest/declarations"
SWEEP = "/api/declarations/sweep"

# The site's limits (frontend/shared/declarations.ts).
MAX_CANDIDACIES_PER_REQUEST = 500
MAX_EXTRACTS_PER_REQUEST = 25
MAX_REQUEST_IMAGE_BYTES = 8_000_000
MAX_CANDIDACIES_PER_EXTRACT = 20
MAX_KIDS = 5
MAX_BIP_URLS = 10
UNIT_LEVELS = {"gmina", "powiat", "wojewodztwo"}
LOCAL_OFFICES = {
    "Rada gminy",
    "Rada miasta",
    "Rada powiatu",
    "Sejmik",
    "Rada dzielnicy",
    "Wójt",
    "Burmistrz",
    "Prezydent",
}
REASON = re.compile(r"^[a-z][a-z0-9_]{0,40}$")
HTTP_URL = re.compile(r"^https?://", re.I)
#: A skip the site may not repeat: the extract came before its candidacy did.
RETRIED_SKIPS = {"unknown_candidacy"}
#: How long to wait before each try again of a request the site did not take.
BACKOFF_S = (5, 15, 45)

METHODS = {"text_layer": "text_layer", "ocr": "ocr", "handwritten": "handwriting"}


def digest(record: dict[str, Any], *images: str) -> str:
    """A hash of what a record says, its pictures by their own hashes."""
    text = json.dumps(record, sort_keys=True, ensure_ascii=False) + "|".join(images)
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def candidacy_record(person: PersonRow, roots: list[str]) -> dict[str, Any] | None:
    """The candidacy as the site takes it, or None when it has no page there."""
    info = person.person
    kids = [str(k) for k in info.get("koryta_ids") or []][:MAX_KIDS]  # type: ignore[attr-defined]
    level, office = info.get("unit_level"), info.get("office")
    if not kids or level not in UNIT_LEVELS or office not in LOCAL_OFFICES:
        return None
    record: dict[str, Any] = {
        "key": person.key,
        "kids": kids,
        "teryt": str(info.get("teryt") or person.unit),
        "level": level,
        "office": office,
        "year": person.election_year,
        "status": person.status,
        "files": person.docs,
    }
    if info.get("unit_name"):
        record["unitName"] = str(info["unit_name"])[:200]
    if person.reason and REASON.match(person.reason):
        record["reason"] = person.reason
    urls = [u for u in roots if HTTP_URL.match(u) and len(u) <= 2000][:MAX_BIP_URLS]
    if urls:
        record["bipUrls"] = urls
    return record


@dataclass
class Extract:
    """One extract to send, with its pictures' ids to load when it goes."""

    id: str
    record: dict[str, Any]
    digest: str
    crop: tuple[str, int] | None = None
    image_bytes: int = 0


@dataclass
class _File:
    """What the upload knows about one file: its links, and whose they are."""

    sha256: str
    links: list[DeclarationLink]
    council: bool


def _served(
    file: _File, crop: DeclarationCropRow | None, people: dict[str, PersonRow]
) -> tuple[list[str], bool, bool | None]:
    """The candidacies a page serves, whether a link named them, and whether the
    name read on the page is theirs (None when nothing was read).

    One person's file serves the candidacies its links named. A council's page
    serves the candidacies whose name is the one read on it, and only when that
    is one person: two namesakes on a council are told apart by a reader, not here.
    """
    name = crop.name if crop else ""
    if not file.council:
        keys = list(dict.fromkeys(link.key for link in file.links if link.named))
        first = people.get(keys[0]) if keys else None
        matches = (
            name_matches(name, first.first_name, first.last_name)
            if name and first
            else None
        )
        return keys, True, matches
    if not name:
        return [], False, None
    keys = [
        key
        for key in dict.fromkeys(link.key for link in file.links)
        if key in people
        and name_matches(name, people[key].first_name, people[key].last_name)
    ]
    persons = {
        (people[k].first_name.lower(), people[k].last_name.lower()) for k in keys
    }
    if len(persons) != 1:
        return [], False, None
    return keys, False, True


def _machine(
    crop: DeclarationCropRow, people: list[PersonRow], name_match: bool | None
) -> dict[str, Any]:
    """What the job read, in the site's terms. Only a date a PDF's text layer
    gives, inside every PKW window of the person's candidacies, is "high": it
    settles without readers (Szymon, 2026-10-29). OCR cannot tell neat
    handwriting from type, so a date it reads is at most "medium"."""
    windows = [
        window
        for p in people
        if (window := birth_window(p.election_year, _int(p.person.get("pkw_age"))))
    ]
    born = date.fromisoformat(crop.birth_date) if len(crop.birth_date) == 10 else None
    in_window = in_windows(born, windows)
    confidence = None
    if born and crop.sort == "text_layer":
        confidence = "high" if in_window == "yes" else "medium"
    elif born and crop.sort == "ocr":
        confidence = "medium" if in_window == "yes" else "low"
    machine: dict[str, Any] = {
        "birthDate": crop.birth_date or None,
        "confidence": confidence,
        "method": METHODS.get(crop.sort),
        "inPkwWindow": in_window,
        "name": crop.name[:200] or None,
        "nameMatches": name_match,
    }
    return machine


def _int(value: object) -> int | None:
    try:
        return int(value)  # type: ignore[call-overload]
    except (TypeError, ValueError):
        return None


def _base(file: _File, keys: list[str], page: int, link_named: bool) -> dict[str, Any]:
    links = [link for link in file.links if link.key in keys] or file.links
    link = next((link for link in links if link.named), links[0])
    record: dict[str, Any] = {
        "sha256": file.sha256,
        "page": page,
        "url": link.url[:2000],
        "candidacies": keys[:MAX_CANDIDACIES_PER_EXTRACT],
        "linkNamed": link_named,
    }
    if HTTP_URL.match(link.page_url) and len(link.page_url) <= 2000:
        record["pageUrl"] = link.page_url
    label = " ".join((link.anchor or link.context).split())[:400]
    if label:
        record["label"] = label
    return record


def extract_records(
    store: BipDeclarationStore, on_site: set[str], people: dict[str, PersonRow]
) -> Iterator[Extract]:
    """Every extract the site should hold: a crop of a page, or a file that gave
    none, for the candidacies on the site it serves."""
    files: dict[str, _File] = {}
    for link in store.links():
        files.setdefault(link.sha256, _File(link.sha256, [], False)).links.append(link)
    for file in files.values():
        named = {
            (people[k].first_name.lower(), people[k].last_name.lower())
            for k in {link.key for link in file.links if link.named}
            if k in people
        }
        file.council = len(named) != 1
    crops: dict[str, list[DeclarationCropRow]] = {}
    for crop in store.crops():
        crops.setdefault(crop.sha256, []).append(crop)
    for sha, cut in store.cuts().items():
        cut_file = files.get(sha)
        if cut_file is None:
            continue
        if cut.status == "cut":
            for crop in crops.get(sha, []):
                extract = _crop_extract(cut_file, crop, on_site, people)
                if extract:
                    yield extract
        elif not cut_file.council:
            extract = _failed_extract(cut_file, cut, on_site)
            if extract:
                yield extract


def extract_id(sha256: str, page: int) -> str:
    """The id the site keeps an extract under: the file and the 0-based page."""
    return f"{sha256}-p{page}"


def _crop_extract(
    file: _File,
    crop: DeclarationCropRow,
    on_site: set[str],
    people: dict[str, PersonRow],
) -> Extract | None:
    keys, link_named, name_match = _served(file, crop, people)
    keys = [k for k in keys if k in on_site]
    if not keys:
        return None
    record = _base(file, keys, crop.page, link_named)
    if crop.declaration_year:
        record["declarationYear"] = crop.declaration_year
    machine = _machine(crop, [people[k] for k in keys], name_match)
    if crop.sort == "blank":
        record.update(outcome="failed", reason="blank_field", machine=machine)
        return Extract(extract_id(file.sha256, crop.page), record, digest(record))
    if not crop.date_png_hash:
        record.update(outcome="failed", reason="no_date_line", machine=machine)
        return Extract(extract_id(file.sha256, crop.page), record, digest(record))
    settles = machine["confidence"] == "high" and len(crop.birth_date) == 10
    record.update(outcome="read" if settles else "crop", machine=machine)
    return Extract(
        extract_id(file.sha256, crop.page),
        record,
        digest(record, crop.date_png_hash, crop.name_png_hash),
        crop=(crop.sha256, crop.page),
    )


def _failed_extract(
    file: _File, cut: DeclarationCutRow, on_site: set[str]
) -> Extract | None:
    keys = [
        k
        for k in dict.fromkeys(link.key for link in file.links if link.named)
        if k in on_site
    ]
    if not keys:
        return None
    record = _base(file, keys, 0, True)
    record.update(outcome="failed", reason=cut.status)
    return Extract(extract_id(file.sha256, 0), record, digest(record))


def due(records: Iterable[tuple[str, str]], sent: dict[str, SentRow]) -> set[str]:
    """The ids whose record is new, changed, or was skipped for want of
    something that may be there now."""
    wanted = set()
    for id_, record_digest in records:
        last = sent.get(id_)
        if (
            last is None
            or last.digest != record_digest
            or (last.result == "skipped" and last.reason in RETRIED_SKIPS)
        ):
            wanted.add(id_)
    return wanted


class _Pictured(Protocol):
    image_bytes: int


def batches[T: _Pictured](extracts: list[T]) -> Iterator[list[T]]:
    """Extracts in requests the site takes: 25 at most, 8 MB of pictures at most."""
    batch: list[T] = []
    size = 0
    for extract in extracts:
        if batch and (
            len(batch) >= MAX_EXTRACTS_PER_REQUEST
            or size + extract.image_bytes > MAX_REQUEST_IMAGE_BYTES
        ):
            yield batch
            batch, size = [], 0
        batch.append(extract)
        size += extract.image_bytes
    if batch:
        yield batch


class ListTooOld(RuntimeError):
    """The night's list does not say what the run was asked to filter by."""


class SiteError(RuntimeError):
    """The site refused a request: retrying the same one will not help."""

    def __init__(self, message: str, status: int | None = None) -> None:
        super().__init__(message)
        #: The HTTP status it answered with; None when no answer said why.
        self.status = status


class SiteUnavailable(RuntimeError):
    """The site did not answer, or not yet: a later run can try again."""

    def __init__(self, message: str, status: int | None = None) -> None:
        super().__init__(message)
        #: The HTTP status of the last answer; None when there was none.
        self.status = status


@dataclass
class Site:
    """The site's ingest, signed in as the run's token source says."""

    endpoint: str
    tokens: TokenSource
    session: Any = field(default_factory=requests.Session)
    sleep: Callable[[float], None] = time.sleep

    def post(
        self,
        path: str,
        body: dict[str, Any],
        *,
        backoff: tuple[float, ...] = BACKOFF_S,
    ) -> dict[str, Any]:
        """The site's answer. One it did not give is asked again after each
        of `backoff`'s waits, so a try more than there are waits."""
        refreshed = False
        for attempt in range(len(backoff) + 1):
            try:
                response = self.session.post(
                    f"{self.endpoint.rstrip('/')}{path}",
                    json=body,
                    headers={"Authorization": f"Bearer {self.tokens.token()}"},
                    timeout=300,
                )
            except (requests.ConnectionError, requests.Timeout) as exc:
                if attempt == len(backoff):
                    raise SiteUnavailable(f"{path}: {exc}") from exc
                self.sleep(backoff[attempt])
                continue
            if response.status_code == 401 and not refreshed:
                refreshed = True
                try:
                    self.tokens.refresh()
                except TokenError as exc:
                    raise SiteError(str(exc)) from exc
                continue
            if response.status_code == 429 or response.status_code >= 500:
                if attempt == len(backoff):
                    raise SiteUnavailable(
                        f"{path}: {response.status_code}", response.status_code
                    )
                self.sleep(backoff[attempt])
                continue
            if not response.ok:
                text = " ".join(response.text.split())[:500]
                raise SiteError(
                    f"{path}: {response.status_code} {text}", response.status_code
                )
            return dict(response.json())
        raise SiteUnavailable(f"{path}: no answer")


@dataclass
class UploadResult:
    candidacies: Counter[str] = field(default_factory=Counter)
    extracts: Counter[str] = field(default_factory=Counter)
    requests: int = 0
    sweep: dict[str, Any] | None = None


def _skips(result: dict[str, Any], part: str, key: str) -> dict[str, str]:
    skipped = (result.get(part) or {}).get("skipped") or []
    return {str(s.get(key)): str(s.get("reason") or "") for s in skipped}


def _sent_rows(
    kind: str, ids_digests: list[tuple[str, str]], skipped: dict[str, str]
) -> list[SentRow]:
    return [
        SentRow(
            kind,
            id_,
            record_digest,
            "skipped" if id_ in skipped else "stored",
            skipped.get(id_, ""),
        )
        for id_, record_digest in ids_digests
    ]


def plan(
    store: BipDeclarationStore,
    *,
    priorities: set[int] | None = None,
    sample: int | None = None,
    public_post: bool = False,
) -> tuple[list[tuple[dict[str, Any], str]], list[Extract]]:
    """What a run would send: the candidacies and extracts new or changed since
    the last, each candidacy with its digest.

    `priorities` keeps the candidacies the night's list ranks so
    (`BipPersonOfInterest.priority`: 0 a draft page without a birth date, 1 a
    draft with one, 3 a published page) and the extracts that serve them.
    `sample` makes a test run of it: that many crops not sent yet, by their ids
    so that a dry run picks the same ones, and only the candidacies they serve.
    `public_post` keeps the candidacies with a public post on their page
    (`BipPersonOfInterest.public_post`), and raises `ListTooOld` on a list that
    does not say.
    """
    # Every candidacy, kept or not: a file's links tell a council's file from
    # one person's by everybody they name.
    people = {p.key: p for p in store.candidacies()}
    if public_post and all(
        p.person.get("public_post") is None for p in people.values()
    ):
        raise ListTooOld(
            "the night's list says nobody's public_post: it was built before the "
            "field existed; the next night's list will"
        )
    roots = store.unit_roots()
    candidacies = []
    for person in people.values():
        if priorities is not None and person.priority not in priorities:
            continue
        if public_post and person.person.get("public_post") is not True:
            continue
        record = candidacy_record(person, roots.get(person.unit, []))
        if record is not None:
            candidacies.append((record, digest(record)))
    on_site = {record["key"] for record, _ in candidacies}
    extracts = list(extract_records(store, on_site, people))
    wanted_extracts = due(((e.id, e.digest) for e in extracts), store.sent("extract"))
    extracts = [e for e in extracts if e.id in wanted_extracts]
    if sample is not None:
        extracts = sorted((e for e in extracts if e.crop), key=lambda e: e.id)[:sample]
        served = {key for e in extracts for key in e.record["candidacies"]}
        candidacies = [(r, d) for r, d in candidacies if r["key"] in served]
    wanted = due(((r["key"], d) for r, d in candidacies), store.sent("candidacy"))
    return [(r, d) for r, d in candidacies if r["key"] in wanted], extracts


def _with_images(store: BipDeclarationStore, extracts: list[Extract]) -> list[Extract]:
    """The extracts' pictures, base64 as the site takes them."""
    images = store.crop_images([e.crop for e in extracts if e.crop])
    for extract in extracts:
        if extract.crop is None:
            continue
        date_png, name_png = images.get(extract.crop, (b"", b""))
        extract.record["images"] = {
            "date": base64.b64encode(date_png).decode("ascii"),
            "name": base64.b64encode(name_png).decode("ascii") if name_png else None,
        }
        extract.image_bytes = len(date_png) + len(name_png)
    return extracts


def upload(
    store: BipDeclarationStore,
    site: Site,
    *,
    tag: str,
    run_id: str,
    max_requests: int | None = None,
    priorities: set[int] | None = None,
    sample: int | None = None,
    public_post: bool = False,
    log: Callable[[str], None] = print,
) -> UploadResult:
    """Send what is new or changed: the candidacies first, as an extract names
    candidacies the site must already hold, then the extracts, a batch at a time,
    each batch's answer kept as it comes. `priorities`, `sample` and
    `public_post` as in `plan`."""
    candidacies, extracts = plan(
        store, priorities=priorities, sample=sample, public_post=public_post
    )
    result = UploadResult()
    log(f"to send: {len(candidacies)} candidacies, {len(extracts)} extracts")
    for start in range(0, len(candidacies), MAX_CANDIDACIES_PER_REQUEST):
        if max_requests is not None and result.requests >= max_requests:
            return result
        chunk = candidacies[start : start + MAX_CANDIDACIES_PER_REQUEST]
        answer = site.post(
            INGEST, {"tag": tag, "runId": run_id, "candidacies": [r for r, _ in chunk]}
        )
        result.requests += 1
        skipped = _skips(answer, "candidacies", "key")
        rows = _sent_rows("candidacy", [(r["key"], d) for r, d in chunk], skipped)
        store.record_sent(rows, run_id)
        result.candidacies.update(row.reason or row.result for row in rows)
    # Pictures are loaded a slice at a time: all of them are a few hundred MB.
    for start in range(0, len(extracts), 100):
        for batch in batches(_with_images(store, extracts[start : start + 100])):
            if max_requests is not None and result.requests >= max_requests:
                return result
            answer = site.post(
                INGEST,
                {"tag": tag, "runId": run_id, "extracts": [e.record for e in batch]},
            )
            result.requests += 1
            skipped = _skips(answer, "extracts", "id")
            rows = _sent_rows("extract", [(e.id, e.digest) for e in batch], skipped)
            store.record_sent(rows, run_id)
            result.extracts.update(row.reason or row.result for row in rows)
            for extract in batch:
                extract.record.pop("images", None)
            log(f"sent {result.requests}: {dict(result.extracts)}")
    if result.requests:
        result.sweep = site.post(SWEEP, {})
    return result


# -- the posts a declaration names (`upload --employment`) -------------------------

EMPLOYMENT_INGEST = "/api/ingest/declarations/employment"
#: `bip_decl_sent`'s kind for a declaration's bands.
EMPLOYMENT = "employment"
#: The bands read now, besides the header: the employer's line under the birth
#: date. Sections VII and VIII wait for the pages whose line names no post.
EMPLOYMENT_BANDS = ("employer",)
#: What the site takes of a band (frontend/shared/declarationEmployment.ts and
#: declarations.ts): past these it would refuse the whole request, so such a
#: declaration stays here.
MAX_STRIPS = 12
MAX_LINES = 40
MAX_LINE_Y = 20_000
MAX_STRIP_PAGE = 500
MAX_IMAGE_BYTES = 200_000
ISO_DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")
#: What a comparison of an agreed date with its pages calls the page whose
#: birth date it is (`employmentGate`, server/utils/declarationEmployment.ts).
MATCHED = frozenset({"confirmed", "queued"})


@dataclass(frozen=True)
class DatePage:
    """A declaration's date page as the site's export has it."""

    id: str
    #: Its birth date agreed, a full date.
    agreed: bool = False
    #: The pages that date was found to be the birth date of: `confirmed` a
    #: published one, `queued` a draft.
    matched: tuple[str, ...] = ()


def date_pages(documents: Iterable[Mapping[Any, Any]]) -> dict[str, DatePage]:
    """The `declarationExtracts` documents of an export, as date pages by id."""
    pages = {}
    for doc in documents:
        agreed, outcomes = doc.get("agreed"), doc.get("pageOutcomes")
        page = DatePage(
            str(doc["id"]),
            doc.get("status") == "agreed"
            and isinstance(agreed, Mapping)
            and agreed.get("kind") == "date",
            tuple(
                sorted(str(p) for p, outcome in outcomes.items() if outcome in MATCHED)
            )
            if isinstance(outcomes, Mapping)
            else (),
        )
        pages[page.id] = page
    return pages


@dataclass
class EmploymentItem:
    """One declaration's header and bands as the site takes them, without
    their pictures until it goes."""

    id: str
    #: The page it is read for.
    person: str
    #: Put off for a newer declaration of the person's.
    later: bool
    record: dict[str, Any]
    digest: str
    #: Each band sent, the header first, with its strips' hashes in order.
    strips: dict[str, tuple[str, ...]]
    image_bytes: int = 0

    @property
    def status(self) -> str:
        """How the site is asked to place it: open, or later."""
        return "later" if self.later else "open"

    @property
    def page(self) -> tuple[str, int]:
        """The date page: its file's sha256, and the page."""
        sha, _, page = self.id.rpartition("-p")
        return sha, int(page)


def image_hash(header: DeclarationBandRow, band: DeclarationBandRow) -> str:
    """What a band's card shows, its header included: the site keys readers'
    answers by it, so an answer to other pictures has no voice."""
    shown = "|".join(s.png_hash for s in header.strips) + "||"
    shown += "|".join(s.png_hash for s in band.strips)
    return hashlib.sha256(shown.encode("ascii")).hexdigest()


def _kids(row: PersonRow) -> list[str]:
    """The pages a candidacy has on the site."""
    kids = row.person.get("koryta_ids")
    if isinstance(kids, str) or not isinstance(kids, Iterable):
        return []
    return [str(kid) for kid in kids]


def _lines(band: DeclarationBandRow) -> list[dict[str, int]]:
    """The band's written lines as the site takes them: a line with no height,
    or on no strip of the band, is none."""
    return [
        {"strip": strip, "top": top, "bottom": bottom}
        for strip, top, bottom in band.lines
        if 0 <= strip < len(band.strips) and 0 <= top < bottom <= MAX_LINE_Y
    ]


def _band(band: DeclarationBandRow) -> dict[str, Any]:
    return {
        "typed": band.typed,
        # The pictures go in when the item goes.
        "strips": [{"page": strip.page} for strip in band.strips],
        "lines": _lines(band),
    }


def _machine_date(value: str, score: float) -> dict[str, Any] | None:
    """A date the cut read, with its line's score; None for none, or for one
    the site would not take as a day (`isReadingDate`)."""
    if not ISO_DAY.match(value):
        return None
    try:
        day = date.fromisoformat(value)
    except ValueError:
        return None
    if not 1900 <= day.year <= 2100:
        return None
    return {"value": value, "score": round(min(max(score, 0.0), 1.0), 3)}


def _unfit(cut: Mapping[str, DeclarationBandRow]) -> str:
    """Why a declaration's bands cannot go, or "": one not cut, or past what
    the site takes."""
    for name in ("header", *EMPLOYMENT_BANDS):
        band = cut.get(name)
        if band is None:
            return f"{name}_missing"
        if band.status != "cut" or not band.strips:
            return f"{name}_{band.status if band.status != 'cut' else 'empty'}"
        if len(band.strips) > MAX_STRIPS:
            return "too_many_strips"
        if len(_lines(band)) > MAX_LINES:
            return "too_many_lines"
        if any(strip.page > MAX_STRIP_PAGE for strip in band.strips):
            return "too_far_in_the_file"
    return ""


def _whose(
    page: DatePage | None, listed: set[str], without_post: set[str]
) -> tuple[str, str]:
    """The page a declaration is read for and "", or "" and why none."""
    if page is None:
        return "", "no_date_page"
    if not page.agreed:
        return "", "date_not_agreed"
    if len(page.matched) != 1:
        return "", "not_one_page"
    [person] = page.matched
    if person not in listed:
        return "", "page_not_listed"
    if person not in without_post:
        return "", "public_post"
    return person, ""


def _when(header: DeclarationBandRow, year: int | None) -> str:
    """The day a declaration is for as far as the job read it, to tell a
    person's newest: its „stanu na”, else the day it was signed, else the end
    of the year it is for; "" when nothing was read."""
    return header.stan_na or header.dnia or (f"{year}-12-31" if year else "")


def _unit(linked: list[PersonRow], person: str) -> str:
    """The unit the declarant was elected in, whose bodies the suggestions put
    first: of the candidacies the file was found for, the page's newest."""
    mine = [row for row in linked if person in _kids(row)] or linked
    newest = max(mine, key=lambda row: (row.election_year, row.key), default=None)
    return newest.unit if newest else ""


def _employment_item(
    item: str,
    person: str,
    later: bool,
    cut: Mapping[str, DeclarationBandRow],
    unit: str,
    bodies: BodyIndex,
    roles: Roles | None,
) -> EmploymentItem:
    header = cut["header"]
    record: dict[str, Any] = {
        "id": item,
        "cutVersion": EMPLOYMENT_CUT_VERSION,
        "later": later,
        "header": {
            **_band(header),
            "asOf": _machine_date(header.stan_na, header.stan_na_score),
            "filedOn": _machine_date(header.dnia, header.dnia_score),
        },
    }
    for name in EMPLOYMENT_BANDS:
        band = cut[name]
        # None on handwriting: what OCR reads of it is noise.
        found = suggest(
            band.ocr_text.splitlines(), unit, bodies, typed=band.typed, roles=roles
        )
        record[name] = {
            **_band(band),
            "imageHash": image_hash(header, band),
            "suggestions": [row.payload() for row in found],
        }
    strips = {
        name: tuple(strip.png_hash for strip in cut[name].strips)
        for name in ("header", *EMPLOYMENT_BANDS)
    }
    hashes = [png for each in strips.values() for png in each]
    return EmploymentItem(item, person, later, record, digest(record, *hashes), strips)


def employment_records(
    store: BipDeclarationStore,
    pages: Mapping[str, DatePage],
    bodies: BodyIndex,
    *,
    roles: Roles | None = None,
) -> tuple[list[EmploymentItem], Counter[str]]:
    """Every declaration whose posts the site should read now, and why each
    other date page with bands is not, counted by reason.

    A declaration is read for a page without a paid public post, as the
    night's list says (`BipPersonOfInterest.public_post`, which `--public-post`
    reads), once its date crop agreed and the comparison with the pages named
    that one page alone (`pages`, the site's export): whose declaration it is
    is the site's word. Of a person's declarations the newest is read first,
    the others go `later`. Its header goes with the employer's line, and a
    printed line with the machine's suggestions (`suggest`)."""
    people = store.candidacies()
    if all(row.person.get("public_post") is None for row in people):
        raise ListTooOld(
            "the night's list says nobody's public_post: it was built before the "
            "field existed; the next night's list will"
        )
    listed: set[str] = set()
    without_post: set[str] = set()
    for row in people:
        listed.update(_kids(row))
        # A candidacy with a post may owe it to another of its pages; one
        # without has none on any.
        if row.person.get("public_post") is False:
            without_post.update(_kids(row))
    by_key = {row.key: row for row in people}
    linked: dict[str, list[PersonRow]] = defaultdict(list)
    for link in store.links():
        if link.key in by_key:
            linked[link.sha256].append(by_key[link.key])
    years = {(crop.sha256, crop.page): crop.declaration_year for crop in store.crops()}
    cuts: dict[tuple[str, int], dict[str, DeclarationBandRow]] = defaultdict(dict)
    for band in store.bands(EMPLOYMENT_CUT_VERSION):
        cuts[(band.sha256, band.page)][band.band] = band

    left_out: Counter[str] = Counter()
    readable: dict[str, list[tuple[str, str, dict[str, DeclarationBandRow]]]] = (
        defaultdict(list)
    )
    for (sha, page), cut in sorted(cuts.items()):
        item = extract_id(sha, page)
        person, why = _whose(pages.get(item), listed, without_post)
        why = why or _unfit(cut)
        if why:
            left_out[why] += 1
            continue
        when = _when(cut["header"], years.get((sha, page)))
        readable[person].append((when, item, cut))

    items = []
    for person, declarations in readable.items():
        _, newest, _ = max(declarations, key=lambda d: d[:2])
        for _, item, cut in declarations:
            sha, _, _ = item.rpartition("-p")
            unit = _unit(linked[sha], person)
            items.append(
                _employment_item(item, person, item != newest, cut, unit, bodies, roles)
            )
    items.sort(key=lambda each: each.id)
    return items, left_out


@dataclass
class EmploymentPlan:
    """What an employment upload sends, and what it does not."""

    #: The declarations new or changed since the last upload.
    items: list[EmploymentItem]
    #: Declarations to read that the site was sent as they are.
    unchanged: int = 0
    #: Date pages with bands that are not read now, by why.
    left_out: Counter[str] = field(default_factory=Counter)

    def statuses(self) -> Counter[str]:
        """The items to send, by how the site is asked to place them."""
        return Counter(item.status for item in self.items)


def employment_plan(
    store: BipDeclarationStore,
    pages: Mapping[str, DatePage],
    bodies: BodyIndex,
    *,
    roles: Roles | None = None,
) -> EmploymentPlan:
    """`employment_records` less what the site was sent as it is."""
    items, left_out = employment_records(store, pages, bodies, roles=roles)
    wanted = due(((item.id, item.digest) for item in items), store.sent(EMPLOYMENT))
    return EmploymentPlan(
        [item for item in items if item.id in wanted],
        len(items) - len(wanted),
        left_out,
    )


def _with_pictures(
    store: BipDeclarationStore, items: list[EmploymentItem], held: Counter[str]
) -> list[EmploymentItem]:
    """The items with their pictures, base64 as the site takes them. One whose
    bands were cut again since it was planned waits for the next run, and so
    does one with a picture the site would refuse."""
    pictures = store.band_pictures(EMPLOYMENT_CUT_VERSION, [i.page for i in items])
    ready = []
    for item in items:
        sha, page = item.page
        pngs = {name: pictures.get((sha, page, name), ()) for name in item.strips}
        if any(
            tuple(map(png_hash, pngs[name])) != hashes
            for name, hashes in item.strips.items()
        ):
            held["cut_again"] += 1
            continue
        sizes = [len(png) for each in pngs.values() for png in each]
        if any(size > MAX_IMAGE_BYTES for size in sizes):
            held["picture_too_big"] += 1
            continue
        for name, each in pngs.items():
            for strip, png in zip(item.record[name]["strips"], each):
                strip["png"] = base64.b64encode(png).decode("ascii")
        item.image_bytes = sum(sizes)
        ready.append(item)
    return ready


@dataclass
class EmploymentResult:
    #: Each declaration sent: stored, or skipped with the site's reason.
    items: Counter[str] = field(default_factory=Counter)
    #: Its bands as the site counted them: created, updated, kept, unchanged.
    bands: Counter[str] = field(default_factory=Counter)
    #: Declarations kept back while sending, by why (`_with_pictures`).
    held: Counter[str] = field(default_factory=Counter)
    requests: int = 0


def upload_employment(
    store: BipDeclarationStore,
    site: Site,
    pages: Mapping[str, DatePage],
    bodies: BodyIndex,
    *,
    tag: str,
    run_id: str,
    max_requests: int | None = None,
    roles: Roles | None = None,
    log: Callable[[str], None] = print,
) -> EmploymentResult:
    """Send the declarations new or changed since the last upload
    (`employment_plan`), a batch at a time, each batch's answer kept as it
    comes. Nothing is swept after: the site places each band as it stores it."""
    plan = employment_plan(store, pages, bodies, roles=roles)
    result = EmploymentResult()
    log(
        f"to send: {len(plan.items)} declarations {dict(plan.statuses())}, "
        f"{plan.unchanged} sent before as they are; "
        f"not read now: {dict(plan.left_out)}"
    )
    # Pictures are loaded a slice at a time, as the date crops' are.
    for start in range(0, len(plan.items), 100):
        ready = _with_pictures(store, plan.items[start : start + 100], result.held)
        for batch in batches(ready):
            if max_requests is not None and result.requests >= max_requests:
                return result
            answer = site.post(
                EMPLOYMENT_INGEST,
                {"tag": tag, "runId": run_id, "items": [i.record for i in batch]},
            )
            result.requests += 1
            skipped = {
                str(s.get("id")): str(s.get("reason") or "")
                for s in answer.get("skipped") or []
            }
            rows = _sent_rows(EMPLOYMENT, [(i.id, i.digest) for i in batch], skipped)
            store.record_sent(rows, run_id)
            result.items.update(row.reason or row.result for row in rows)
            counted = answer.get("bands") or {}
            result.bands.update({str(k): int(v) for k, v in counted.items()})
            for item in batch:
                for name in item.strips:
                    for strip in item.record[name]["strips"]:
                        strip.pop("png", None)
            log(f"sent {result.requests}: {dict(result.items)}")
    return result
