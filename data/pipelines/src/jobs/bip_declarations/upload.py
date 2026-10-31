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
After the upload the job calls `/api/declarations/sweep`, which compares the
readings settled since with their pages.
"""

from __future__ import annotations

import base64
import hashlib
import json
import re
import time
from collections import Counter
from collections.abc import Callable, Iterable, Iterator
from dataclasses import dataclass, field
from datetime import date
from typing import Any

import requests

from jobs.bip_declarations.reading import birth_window, in_windows, name_matches
from scrapers.stores import (
    BipDeclarationStore,
    DeclarationCropRow,
    DeclarationCutRow,
    DeclarationLink,
    PersonRow,
    SentRow,
)
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
        return Extract(f"{file.sha256}-p{crop.page}", record, digest(record))
    if not crop.date_png_hash:
        record.update(outcome="failed", reason="no_date_line", machine=machine)
        return Extract(f"{file.sha256}-p{crop.page}", record, digest(record))
    settles = machine["confidence"] == "high" and len(crop.birth_date) == 10
    record.update(outcome="read" if settles else "crop", machine=machine)
    return Extract(
        f"{file.sha256}-p{crop.page}",
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
    return Extract(f"{file.sha256}-p0", record, digest(record))


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


def batches(extracts: list[Extract]) -> Iterator[list[Extract]]:
    """Extracts in requests the site takes: 25 at most, 8 MB of pictures at most."""
    batch: list[Extract] = []
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


class SiteError(RuntimeError):
    """The site refused a request: retrying the same one will not help."""


class SiteUnavailable(RuntimeError):
    """The site did not answer, or not yet: a later run can try again."""


@dataclass
class Site:
    """The site's ingest, signed in as the run's token source says."""

    endpoint: str
    tokens: TokenSource
    session: Any = field(default_factory=requests.Session)
    sleep: Callable[[float], None] = time.sleep

    def post(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        refreshed = False
        for attempt in range(len(BACKOFF_S) + 1):
            try:
                response = self.session.post(
                    f"{self.endpoint.rstrip('/')}{path}",
                    json=body,
                    headers={"Authorization": f"Bearer {self.tokens.token()}"},
                    timeout=300,
                )
            except (requests.ConnectionError, requests.Timeout) as exc:
                if attempt == len(BACKOFF_S):
                    raise SiteUnavailable(f"{path}: {exc}") from exc
                self.sleep(BACKOFF_S[attempt])
                continue
            if response.status_code == 401 and not refreshed:
                refreshed = True
                try:
                    self.tokens.refresh()
                except TokenError as exc:
                    raise SiteError(str(exc)) from exc
                continue
            if response.status_code == 429 or response.status_code >= 500:
                if attempt == len(BACKOFF_S):
                    raise SiteUnavailable(f"{path}: {response.status_code}")
                self.sleep(BACKOFF_S[attempt])
                continue
            if not response.ok:
                text = " ".join(response.text.split())[:500]
                raise SiteError(f"{path}: {response.status_code} {text}")
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
) -> tuple[list[tuple[dict[str, Any], str]], list[Extract]]:
    """What a run would send: the candidacies and extracts new or changed since
    the last, each candidacy with its digest.

    `priorities` keeps the candidacies the people mode ranked so
    (`BipPersonOfInterest.priority`: 0 a draft page without a birth date, 1 a
    draft with one, 3 a published page) and the extracts that serve them.
    `sample` makes a test run of it: that many crops not sent yet, by their ids
    so that a dry run picks the same ones, and only the candidacies they serve.
    """
    # Every candidacy, kept or not: a file's links tell a council's file from
    # one person's by everybody they name.
    people = {p.key: p for p in store.candidacies()}
    roots = store.unit_roots()
    candidacies = []
    for person in people.values():
        if priorities is not None and person.priority not in priorities:
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
    log: Callable[[str], None] = print,
) -> UploadResult:
    """Send what is new or changed: the candidacies first, as an extract names
    candidacies the site must already hold, then the extracts, a batch at a time,
    each batch's answer kept as it comes. `priorities` and `sample` as in `plan`."""
    candidacies, extracts = plan(store, priorities=priorities, sample=sample)
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
