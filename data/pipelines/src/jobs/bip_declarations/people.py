"""How far the declarations got, in people: the snapshot that
`koryta_bip_declarations people` counts once a night and sends the site, for
the home page, /oswiadczenia/postep and /admin/oswiadczenia.

Only this job can count it, since half of it is here and half on the site.
What was cut and not sent, the files not cut and the BIPs that would not let
the crawler through are in the crawl's Postgres (`BipDeclarationStore`). What
readers settled, and what a settled date did to a page, is the site's, read
off the night's export (`read_site`). The people are the night's list.

Who is counted (decision on 2026-11-15): the list's pages with a public post,
a paid post, current or ended, at a company the site calls public
(`pages_with_a_public_post`), which is the only kind of page the site publishes
from a declaration. Of those, the drafts and the pages a declaration published.
A page made public some other way is left out: a declaration has nothing left
to do there.

Each person is in one stage, the first that holds, so the stages add up:

1. published: a declaration published the page.
2. held: a settled reading has the page's birth date and the page waits, for
   its slot of the day (`queued`) or for an admin.
3. namesakes, mismatched: a settled reading has another birth date
   (`different_kind` tells which).
4. reading: a crop of theirs is on the site and nobody has settled it yet.
5. cropped: a crop cut here that the upload would send, not on the site yet.
6. downloaded: a file of theirs came down and is not cut yet.
7. searching: no date to read yet, and why (`SEARCH_REASONS`). A council's
   file that names nobody counts for a person only through a page with their
   name on it; files with none are a search that found nothing of theirs.

The contract is the site's: `declarationPeopleSchema` in
frontend/shared/declarations.ts, sent to `POST /api/ingest/declarations/people`.
"""

from __future__ import annotations

import csv
from collections import Counter, defaultdict
from collections.abc import Iterable, Iterator, Mapping
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd
from leveldb_export import parse_leveldb_documents  # type: ignore

from analysis.bip_people_of_interest import pages_with_a_public_post
from analysis.utils.names import FirstNameFreq, NamesCountByRegion
from jobs.bip_declarations.upload import candidacy_record, extract_records
from scrapers.stores import BipDeclarationStore, Context, PersonRow

INGEST = "/api/ingest/declarations/people"
WARSAW = ZoneInfo("Europe/Warsaw")

#: `declarationPeopleSchema`'s stages, which add up to `people`.
STAGES = (
    "published",
    "namesakes",
    "mismatched",
    "held",
    "reading",
    "cropped",
    "downloaded",
    "searching",
)
#: The stages of the people whose date somebody has read: what the namesake
#: rate is learnt from. The rest are what it is applied to.
SETTLED = frozenset({"published", "held", "namesakes", "mismatched"})

#: The crawler's not_found reasons that mean the BIP would not let it through,
#: in the order one is named when a person's candidacies give several.
BIP_REASONS = (
    "unreachable",
    "refused",
    "robots",
    "throttled",
    "timeout",
    "download_failed",
    "budget",
    "no_seed",
)
#: A search that went through and found no declaration of theirs.
ABSENT_REASONS = ("not_listed", "no_declarations")
#: `peopleSearchReasons`: the above, then a file with no date to read, then
#: nothing tried yet.
SEARCH_REASONS = (
    *BIP_REASONS,
    *ABSENT_REASONS,
    "no_date_line",
    "unreadable",
    "other_page",
    "pending",
)

#: What a settled reading said of a page with the same birth date
#: (`PageOutcome`): queued for its slot, held, or public already.
MATCHED = frozenset({"queued", "held", "confirmed"})
#: A crop on the site that nobody has settled yet.
OPEN = frozenset({"open", "disputed"})

#: The bands of surname bearers the namesake estimate works in: the share of
#: namesakes climbs with how common a surname is, from none under 50 bearers
#: to nearly half at 20,000 and over (measured on 2026-11-14).
BANDS: tuple[tuple[int, int | None], ...] = (
    (0, 50),
    (50, 1_000),
    (1_000, 5_000),
    (5_000, 20_000),
    (20_000, None),
)
#: Settled people a band needs before its rate is applied to anybody.
MIN_SETTLED = 20
BOOTSTRAP = 1000
SEED = 3
TOP_UNITS = 8
#: `publishedByDay` takes this many days at most.
MAX_DAYS = 400
#: The youngest a councillor can be: a birth year later than this many years
#: back is the date the form was signed, typed where the birth date goes.
ADULT = 18


# --------------------------------------------------------------- names ----


@dataclass(frozen=True)
class Names:
    """PESEL's living people (`analysis.utils.names`): how many carry each
    surname in each sex's form, summed over voivodeships, and how many carry
    each first name, by sex (M, K)."""

    surnames: Mapping[str, Mapping[str, int]]
    first_names: Mapping[str, Mapping[str, int]]

    def sex(self, first_name: str) -> str:
        """M or K: the sex that carries the first name more often; a name
        PESEL does not list is a woman's when it ends in a."""
        name = (first_name.split() or [""])[0].upper()
        men = self.first_names["M"].get(name, 0)
        women = self.first_names["K"].get(name, 0)
        if men == women == 0:
            return "K" if name.endswith("A") else "M"
        return "M" if men >= women else "K"

    def bearers(self, first_name: str, last_name: str) -> int:
        """Living Poles with the surname in the person's sex's form; 0 for one
        PESEL does not list, as most double surnames."""
        return self.surnames[self.sex(first_name)].get(last_name.strip().upper(), 0)


def _counts(rows: Iterable[str], name: str, count: str) -> Counter[str]:
    counts: Counter[str] = Counter()
    for row in csv.DictReader(rows):
        counts[row[name].strip().upper()] += int(row[count])
    return counts


def read_names(ctx: Context) -> Names:
    """The PESEL tables, from the downloaded cache (fetched on a miss)."""
    men, women = NamesCountByRegion.surnames
    men_first, women_first = FirstNameFreq.firstnames

    def table(ref: Any, name: str, count: str) -> Counter[str]:
        text = ctx.io.read_data(ref).read_bytes().decode("utf-8")
        return _counts(text.splitlines(), name, count)

    surname, bearers = "Nazwisko aktualne", "Liczba"
    first, carriers = "IMIĘ_PIERWSZE", "LICZBA_WYSTĄPIEŃ"
    return Names(
        surnames={
            "M": table(men, surname, bearers),
            "K": table(women, surname, bearers),
        },
        first_names={
            "M": table(men_first, first, carriers),
            "K": table(women_first, first, carriers),
        },
    )


# ---------------------------------------------------------------- site ----


@dataclass(frozen=True)
class Page:
    """A person's page as the export has it."""

    published: bool
    birth_date: str = ""


@dataclass(frozen=True)
class SiteCrop:
    """A crop the site holds for a page: where its reading stands, and what a
    settled one said of the page (`pageOutcomes`)."""

    id: str
    status: str
    outcome: str | None = None
    #: The settled date, YYYY-MM-DD or YYYY.
    value: str | None = None


@dataclass(frozen=True)
class Publication:
    """A page's `declarationPublications` record."""

    status: str
    reason: str | None = None
    #: The Warsaw day it was published.
    published_on: str | None = None


@dataclass
class SiteState:
    """The site's half of the count, as one export has it."""

    #: The export's day, YYYY-MM-DD.
    day: str
    pages: dict[str, Page] = field(default_factory=dict)
    public_posts: set[str] = field(default_factory=set)
    publications: dict[str, Publication] = field(default_factory=dict)
    crops: dict[str, list[SiteCrop]] = field(default_factory=dict)
    merged_into: dict[str, str] = field(default_factory=dict)

    def resolve(self, page: str) -> str:
        """The page a merged one went into, followed to the end."""
        seen = {page}
        while (next_page := self.merged_into.get(page)) and next_page not in seen:
            seen.add(next_page)
            page = next_page
        return page


#: What the count reads of the export. The export holds them all
#: (`collectionIds` in frontend/functions/src/index.ts).
KINDS = ("nodes", "edges", "declarationPublications", "declarationExtracts")


class ExportIncomplete(RuntimeError):
    """The export does not hold a collection the count needs, or not whole."""


def export_root(path: Path) -> Path:
    """The export's `all_namespaces` directory, given it or the export."""
    return path if path.name == "all_namespaces" else path / "all_namespaces"


def export_taken(path: Path) -> datetime:
    """When the export was taken: its directory is `date=<ISO timestamp>`."""
    for part in reversed(path.parts):
        if part.startswith("date="):
            try:
                return datetime.fromisoformat(part.removeprefix("date="))
            except ValueError:
                break
    raise ExportIncomplete(f"{path} is not under a date=<timestamp> directory")


def export_day(path: Path) -> str:
    """YYYY-MM-DD of the export, in UTC as Firestore names it."""
    return export_taken(path).astimezone(timezone.utc).date().isoformat()


def is_complete(path: Path) -> bool:
    """Whether every collection the count reads came down whole: Firestore
    writes a collection's metadata file once its shards are all written."""
    root = export_root(path)
    return all(
        any((root / f"kind_{kind}").glob("*.export_metadata"))
        and any((root / f"kind_{kind}").glob("output-*"))
        for kind in KINDS
    )


def newest_export(base: Path) -> Path:
    """The newest complete export under `base`, a `date=<timestamp>` directory
    each, as the morning check and people.sh fetch them."""
    for path in sorted(base.glob("date=*"), reverse=True):
        if is_complete(path):
            return path
    raise ExportIncomplete(f"no complete export under {base}")


def read_kind(root: Path, kind: str) -> Iterator[dict[str, Any]]:
    """The documents of one collection, each with its id under `_id`."""
    shards = sorted((root / f"kind_{kind}").glob("output-*"))
    if not shards:
        raise ExportIncomplete(f"{root} holds no {kind}")
    for shard in shards:
        for document in parse_leveldb_documents(str(shard)):
            key = document.pop("_key", None) or {}
            document["_id"] = str(key.get("name", ""))
            yield document


def _warsaw_day(value: object) -> str | None:
    if not isinstance(value, datetime):
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(WARSAW).date().isoformat()


def read_site(path: Path) -> SiteState:
    """The site's half from a local export: the person pages, which of them
    hold a public post, what was published and what each crop said."""
    root = export_root(path)
    site = SiteState(day=export_day(root))
    places = []
    for node in read_kind(root, "nodes"):
        id_ = node["_id"]
        merged = node.get("merged_into")
        if isinstance(merged, str) and merged:
            site.merged_into[id_] = merged
            continue
        places.append(
            {
                "id": id_,
                "isPublic": node.get("isPublic") is True,
                "supervisoryBody": node.get("supervisoryBody"),
            }
        )
        if node.get("type") == "person":
            site.pages[id_] = Page(
                published=node.get("published") is True,
                birth_date=str(node.get("birthDate") or ""),
            )
    edges = [
        {
            "source": edge.get("source"),
            "target": edge.get("target"),
            "type": edge.get("type"),
            "name": edge.get("name"),
            "deleted": edge.get("deleted") is True,
        }
        for edge in read_kind(root, "edges")
    ]
    site.public_posts = {
        site.resolve(page)
        for page in pages_with_a_public_post(
            pd.DataFrame(places, columns=["id", "isPublic", "supervisoryBody"]),
            pd.DataFrame(
                edges, columns=["source", "target", "type", "name", "deleted"]
            ),
        )
    }
    for record in read_kind(root, "declarationPublications"):
        page = site.resolve(str(record.get("personId") or record["_id"]))
        site.publications[page] = Publication(
            status=str(record.get("status") or ""),
            reason=record.get("reason") or None,
            published_on=_warsaw_day(record.get("publishedAt")),
        )
    crops: dict[str, list[SiteCrop]] = defaultdict(list)
    for extract in read_kind(root, "declarationExtracts"):
        outcomes = extract.get("pageOutcomes") or {}
        agreed = extract.get("agreed") or {}
        value = agreed.get("value") if isinstance(agreed, dict) else None
        pages = dict.fromkeys([*(extract.get("personIds") or []), *outcomes])
        for page in pages:
            crops[site.resolve(str(page))].append(
                SiteCrop(
                    id=extract["_id"],
                    status=str(extract.get("status") or ""),
                    outcome=outcomes.get(page),
                    value=str(value) if value else None,
                )
            )
    site.crops = dict(crops)
    return site


# --------------------------------------------------------------- crawl ----


@dataclass
class Crawl:
    """How far predator got with one candidacy's files."""

    #: A crop of theirs the upload would send, and the site does not hold.
    to_send: bool = False
    #: A crop of theirs the site holds.
    sent: bool = False
    #: A file of theirs not cut by this version of the cutter.
    to_cut: bool = False
    #: A file a link names them in, cut. A council's file that names nobody
    #: is theirs only through a crop with their name (`to_send`, `sent`).
    cut: bool = False


def read_crawl(
    store: BipDeclarationStore, candidacies: list[PersonRow], version: int
) -> dict[str, Crawl]:
    """Each candidacy's files, cuts and crops, by key. A crop counts for the
    candidacies the upload sends it for (`extract_records`): a council's file
    serves only the people whose name is read on a page of it."""
    people = {row.key: row for row in candidacies}
    on_site = {
        key for key, row in people.items() if candidacy_record(row, []) is not None
    }
    crawl: dict[str, Crawl] = defaultdict(Crawl)
    cuts = store.cuts()
    for link in store.links():
        if link.key not in people:
            continue
        cut = cuts.get(link.sha256)
        if cut is None or cut.version < version:
            crawl[link.key].to_cut = True
        elif link.named:
            crawl[link.key].cut = True
    stored = {
        id_ for id_, row in store.sent("extract").items() if row.result == "stored"
    }
    for extract in extract_records(store, on_site, people):
        if extract.record.get("outcome") == "failed":
            continue
        for key in extract.record["candidacies"]:
            if extract.id in stored:
                crawl[key].sent = True
            else:
                crawl[key].to_send = True
    return dict(crawl)


# --------------------------------------------------------------- count ----


@dataclass
class Person:
    """One person counted, with the stage they are in."""

    page: str
    stage: str
    #: Why a searching person has no date (`SEARCH_REASONS`); where a held
    #: page waits (its publication's status, and a held one's reason).
    detail: str
    #: The unit the person is counted under: the one whose search gave the
    #: reason, else the newest candidacy's.
    unit: str
    unit_name: str
    bearers: int
    published_on: str | None = None


def _newest(rows: Iterable[PersonRow]) -> PersonRow:
    return min(rows, key=lambda row: (-row.election_year, row.key))


def search_reason(rows: list[PersonRow]) -> tuple[str, PersonRow]:
    """Why the search found no declaration of theirs, and the candidacy that
    says so: the BIP not letting the crawler through before a search that
    found nothing, else nothing tried yet. Files that came down without a
    link naming them (`unconfirmed`), none of whose pages is theirs, are a
    search that found nothing of theirs: `not_listed`."""
    by_key = sorted(rows, key=lambda r: r.key)
    not_found = [row for row in by_key if row.status == "not_found"]
    for reason in (*BIP_REASONS, *ABSENT_REASONS):
        for row in not_found:
            if row.reason == reason:
                return reason, row
    for row in by_key:
        if row.status == "unconfirmed":
            return "not_listed", row
    return "pending", _newest(rows)


def different_kind(read: str, page: str, *, this_year: int) -> str:
    """`namesake` or `mismatched`: what a settled date other than the page's
    birth date most likely is.

    A few years off, or the same year with the day and month far apart, is
    another person's date: a namesake. A digit or two off in the same year,
    the same day and month in another year, a year a councillor cannot be
    born in (the date the form was signed) or one ten years and more off
    (another file) is a misreading or a wrong file, for an admin. A year read
    alone that is not the page's is a namesake.
    """
    if len(read) < 4 or not read[:4].isdigit():
        return "mismatched"
    year = int(read[:4])
    if year > this_year - ADULT:
        return "mismatched"
    if len(read) == 4:
        return "namesake"
    if len(page) < 10 or not page[:4].isdigit():
        return "mismatched"
    page_year = int(page[:4])
    if year == page_year:
        slips = sum(a != b for a, b in zip(read, page))
        return "mismatched" if slips <= 2 else "namesake"
    if read[4:] == page[4:]:
        return "mismatched"
    return "namesake" if abs(year - page_year) < 10 else "mismatched"


def stage_of(
    page: str,
    rows: list[PersonRow],
    crawl: Mapping[str, Crawl],
    site: SiteState,
    *,
    this_year: int,
) -> tuple[str, str]:
    """The person's stage, and its detail (see `Person`)."""
    publication = site.publications.get(page)
    if publication is not None and publication.status == "published":
        return "published", ""
    crops = site.crops.get(page, [])
    outcomes = {crop.outcome for crop in crops if crop.outcome}
    if outcomes & MATCHED:
        if publication is None:
            return "held", "unrecorded"
        if publication.status == "held" and publication.reason:
            return "held", f"held:{publication.reason}"
        return "held", publication.status
    birth_date = site.pages[page].birth_date
    kinds = {
        different_kind(crop.value, birth_date, this_year=this_year)
        for crop in crops
        if crop.outcome == "different" and crop.value
    }
    if kinds:
        # One namesake's date is enough: a misread or wrong file beside it
        # does not make the page the councillor's.
        return ("namesakes" if "namesake" in kinds else "mismatched"), ""
    if "no_date" in outcomes:
        # A date read for a page without one: nothing to compare it with until
        # a reviewer takes the register's date the pipeline proposes.
        return "held", "no_date"
    if any(
        crop.status in OPEN or (crop.status == "agreed" and not crop.outcome)
        for crop in crops
    ):
        return "reading", ""
    states = [crawl[row.key] for row in rows if row.key in crawl]
    if any(state.to_send for state in states):
        return "cropped", ""
    if any(state.to_cut for state in states):
        return "downloaded", ""
    statuses = {crop.status for crop in crops}
    if "unreadable" in statuses:
        return "searching", "unreadable"
    if "withdrawn" in statuses or any(state.sent for state in states):
        return "searching", "other_page"
    if "failed" in statuses or any(state.cut for state in states):
        return "searching", "no_date_line"
    return "searching", search_reason(rows)[0]


@dataclass
class Count:
    """The snapshot, the people in it, and the pages left out and why."""

    snapshot: dict[str, Any]
    people: list[Person]
    left_out: Counter[str]


def count_people(
    candidacies: list[PersonRow],
    crawl: Mapping[str, Crawl],
    site: SiteState,
    names: Names,
    *,
    at: datetime,
    seed: int = SEED,
) -> Count:
    """Everybody the list and the site say a declaration can publish, each in
    one stage, as the site's `DeclarationPeople`."""
    by_page: dict[str, list[PersonRow]] = defaultdict(list)
    for row in candidacies:
        for page in row.person.get("koryta_ids") or []:  # type: ignore[attr-defined]
            by_page[site.resolve(str(page))].append(row)
    people: list[Person] = []
    left_out: Counter[str] = Counter()
    for page, rows in sorted(by_page.items()):
        state = site.pages.get(page)
        publication = site.publications.get(page)
        if state is None:
            left_out["no page in the export"] += 1
            continue
        if page not in site.public_posts:
            left_out["no public post"] += 1
            continue
        if state.published and (
            publication is None or publication.status != "published"
        ):
            left_out["public, not through a declaration"] += 1
            continue
        stage, detail = stage_of(page, rows, crawl, site, this_year=at.year)
        newest = _newest(rows)
        unit = search_reason(rows)[1] if stage == "searching" else newest
        people.append(
            Person(
                page=page,
                stage=stage,
                detail=detail,
                unit=unit.unit,
                unit_name=str(unit.person.get("unit_name") or ""),
                bearers=names.bearers(newest.first_name, newest.last_name),
                published_on=publication.published_on
                if stage == "published" and publication
                else None,
            )
        )
    return Count(snapshot(people, site.day, at=at, seed=seed), people, left_out)


def band(bearers: int) -> int:
    return next(
        i for i, (low, high) in enumerate(BANDS) if high is None or bearers < high
    )


def namesake_estimate(
    people: list[Person], *, seed: int = SEED
) -> tuple[list[dict[str, Any]], dict[str, int] | None]:
    """The settled people by how common their surname is and how many of them
    turned out namesakes, and the namesakes to expect among the rest: each
    band's share applied to the people in it whose date nobody has read,
    with a 90% interval from resampling the settled. None when a band with
    people to apply it to has too few settled to say."""
    settled = [p for p in people if p.stage in SETTLED]
    remaining = Counter(band(p.bearers) for p in people if p.stage not in SETTLED)
    bands = np.array([band(p.bearers) for p in settled], dtype=int)
    namesakes = np.array([p.stage == "namesakes" for p in settled], dtype=float)
    seen = np.bincount(bands, minlength=len(BANDS))
    rows = [
        {
            "min": low,
            "max": high,
            "settled": int(seen[i]),
            "namesakes": int(namesakes[bands == i].sum()),
            "remaining": remaining[i],
        }
        for i, (low, high) in enumerate(BANDS)
    ]
    if any(remaining[i] and seen[i] < MIN_SETTLED for i in range(len(BANDS))):
        return rows, None
    left = np.array([remaining[i] for i in range(len(BANDS))], dtype=float)

    def expected(sample_bands: np.ndarray, sample_namesakes: np.ndarray) -> float:
        n = np.bincount(sample_bands, minlength=len(BANDS))
        k = np.bincount(sample_bands, weights=sample_namesakes, minlength=len(BANDS))
        share = np.divide(k, n, out=np.zeros(len(BANDS)), where=n > 0)
        return float((share * left).sum())

    point = expected(bands, namesakes)
    if not settled:
        return rows, {"count": 0, "low": 0, "high": 0}
    draws = np.random.default_rng(seed).integers(
        0, len(settled), size=(BOOTSTRAP, len(settled))
    )
    low, high = np.percentile(
        [expected(bands[draw], namesakes[draw]) for draw in draws], [5, 95]
    )
    return rows, {"count": round(point), "low": round(low), "high": round(high)}


def _top_units(people: list[Person]) -> list[dict[str, Any]]:
    """The units with the most people whose BIP would not let the crawler
    through, each with the reason most of them have."""
    blocked = [
        p
        for p in people
        if p.stage == "searching"
        and p.detail in BIP_REASONS
        and len(p.unit) == 6
        and p.unit.isdigit()
    ]
    by_unit: dict[str, list[Person]] = defaultdict(list)
    for p in blocked:
        by_unit[p.unit].append(p)
    ranked = sorted(by_unit.items(), key=lambda kv: (-len(kv[1]), kv[0]))
    top = []
    for teryt, members in ranked[:TOP_UNITS]:
        reasons = Counter(p.detail for p in members)
        reason = min(BIP_REASONS, key=lambda r: (-reasons[r], BIP_REASONS.index(r)))
        name = next((p.unit_name for p in members if p.unit_name), "") or teryt
        top.append(
            {
                "teryt": teryt,
                "name": name[:200],
                "people": len(members),
                "reason": reason,
            }
        )
    return top


def _iso(at: datetime) -> str:
    """UTC with a Z, as zod's `datetime()` takes it."""
    return at.astimezone(timezone.utc).isoformat(timespec="milliseconds")[:-6] + "Z"


def snapshot(
    people: list[Person], export_day: str, *, at: datetime, seed: int = SEED
) -> dict[str, Any]:
    """The site's `DeclarationPeople`."""
    stages = Counter(p.stage for p in people)
    searching = Counter(p.detail for p in people if p.stage == "searching")
    by_surname, expected = namesake_estimate(people, seed=seed)
    days = Counter(
        p.published_on for p in people if p.stage == "published" and p.published_on
    )
    return {
        "at": _iso(at),
        "exportDay": export_day,
        "people": len(people),
        **{stage: stages[stage] for stage in STAGES},
        "searchingBy": [
            {"reason": reason, "count": n}
            for reason, n in sorted(
                searching.items(), key=lambda kv: (-kv[1], SEARCH_REASONS.index(kv[0]))
            )
        ],
        "expectedNamesakes": expected,
        "bySurname": by_surname,
        "topUnits": _top_units(people),
        "publishedByDay": [
            {"day": day, "count": n} for day, n in sorted(days.items())[-MAX_DAYS:]
        ],
    }


def report(count: Count) -> list[str]:
    """What a run prints: the stages, and what is behind the two that hide
    the most (held, searching), and who was left out."""
    snap = count.snapshot
    held = Counter(p.detail for p in count.people if p.stage == "held")

    def listed(counter: Mapping[str, int]) -> str:
        items = sorted(counter.items(), key=lambda kv: (-kv[1], kv[0]))
        return ", ".join(f"{k} {v:,}" for k, v in items)

    lines = [
        f"people a declaration can publish: {snap['people']:,} "
        f"(export of {snap['exportDay']})",
        *(f"  {stage:11} {snap[stage]:>6,}" for stage in STAGES),
        f"  held: {listed(held)}" if held else "  held: nobody",
        "  searching: "
        + ", ".join(f"{r['reason']} {r['count']:,}" for r in snap["searchingBy"]),
        f"left out: {listed(count.left_out)}",
    ]
    expected = snap["expectedNamesakes"]
    lines.append(
        "namesakes to expect among the rest: "
        + (
            f"{expected['count']:,} ({expected['low']:,}-{expected['high']:,})"
            if expected
            else "too few settled to say"
        )
    )
    return lines
