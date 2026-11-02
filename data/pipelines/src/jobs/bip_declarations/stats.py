"""What `koryta_bip_declarations status` prints: where the declarations stand.

Over the night's list, as `cut` and `upload` see it: the candidacies and what
the people mode's search made of them, the files it downloaded for them, what
the cut made of those files and what went to the site, by priority; then the
units (TERYT) where nothing was downloaded for anybody. The first line counts
the job's tables whole, on the list or not, as the site was sent them.

It only reads the store, so it runs beside a cut or a crawl chunk.
"""

from __future__ import annotations

import csv
from collections import Counter, defaultdict
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path

from jobs.bip_crawler.people_list import outcomes
from jobs.bip_declarations.upload import extract_id
from scrapers.stores import BipDeclarationStore, PersonRow, SentRow

#: `BipPersonOfInterest.priority`.
PRIORITIES = {0: "draft, no date", 1: "draft, dated", 2: "not on site", 3: "published"}
#: A TERYT's first two digits.
VOIVODESHIPS = {
    "02": "dolnośląskie",
    "04": "kujawsko-pomorskie",
    "06": "lubelskie",
    "08": "lubuskie",
    "10": "łódzkie",
    "12": "małopolskie",
    "14": "mazowieckie",
    "16": "opolskie",
    "18": "podkarpackie",
    "20": "podlaskie",
    "22": "pomorskie",
    "24": "śląskie",
    "26": "świętokrzyskie",
    "28": "warmińsko-mazurskie",
    "30": "wielkopolskie",
    "32": "zachodniopomorskie",
}


@dataclass(frozen=True)
class EmptyUnit:
    """A unit nothing was downloaded in, for any of its candidacies."""

    teryt: str
    name: str
    level: str
    candidacies: int
    #: Candidacies with a page on the site.
    on_site: int
    #: What the search made of them, as `people_list.outcomes` counts it.
    outcomes: dict[str, int]


def _counts(counter: Counter[str] | dict[str, int]) -> str:
    """Counts as text, most first: found 12, not_found 4."""
    items = sorted(counter.items(), key=lambda kv: (-kv[1], kv[0]))
    return ", ".join(f"{k} {v:,}" for k, v in items)


def _on_site(row: PersonRow) -> bool:
    return bool(row.person.get("koryta_ids"))


def empty_units(
    people: Iterable[PersonRow], files: dict[str, set[str]]
) -> list[EmptyUnit]:
    """The units none of whose candidacies has a file, the biggest first.
    `files`: each candidacy's downloaded files, by key."""
    by_unit: dict[str, list[PersonRow]] = defaultdict(list)
    for row in people:
        by_unit[row.unit].append(row)
    empty = [
        EmptyUnit(
            teryt=unit,
            name=str(rows[0].person.get("unit_name", "")),
            level=str(rows[0].person.get("unit_level", "")),
            candidacies=len(rows),
            on_site=sum(map(_on_site, rows)),
            outcomes=outcomes(rows),
        )
        for unit, rows in by_unit.items()
        if not any(files.get(row.key) for row in rows)
    ]
    return sorted(empty, key=lambda u: (-u.candidacies, u.teryt))


def report(
    store: BipDeclarationStore, *, version: int, units: int = 20
) -> tuple[list[str], list[EmptyUnit]]:
    """The lines `status` prints, and every unit nothing was downloaded in.
    `version`: the cutter's; a file cut by an older one is not cut yet."""
    people = store.candidacies()
    listed = {row.key for row in people}
    files: dict[str, set[str]] = defaultdict(set)
    for link in store.links():
        if link.key in listed:
            files[link.key].add(link.sha256)
    cuts = store.cuts()
    all_crops = store.crops()
    crops: dict[str, list[int]] = defaultdict(list)
    for crop in all_crops:
        crops[crop.sha256].append(crop.page)
    candidacies_sent = store.sent("candidacy")
    extracts_sent = store.sent("extract")
    stored = {id_ for id_, row in extracts_sent.items() if row.result == "stored"}

    def answers(sent: Iterable[SentRow]) -> str:
        return _counts(Counter(row.reason or row.result for row in sent))

    lines = [
        f"the job's tables, on the list or not: files cut {len(cuts):,}, "
        f"crops {len(all_crops):,}; sent: candidacies {len(candidacies_sent):,} "
        f"({answers(candidacies_sent.values())}), extracts {len(extracts_sent):,} "
        f"({answers(extracts_sent.values())})",
        "",
        f"candidacies on the night's list: {len(people):,} "
        f"in {len({row.unit for row in people}):,} units",
        f"  {_counts(Counter(row.status for row in people))}",
        "  not found: "
        + _counts(Counter(r.reason for r in people if r.status == "not_found")),
    ]

    downloaded = set().union(*files.values()) if files else set()
    done = {sha for sha in downloaded if sha in cuts and cuts[sha].version >= version}
    sorts = Counter(crop.sort for crop in all_crops if crop.sha256 in done)
    pages = [(sha, page) for sha in done for page in crops.get(sha, [])]
    on_site = sum(extract_id(sha, page) in stored for sha, page in pages)
    lines += [
        "",
        f"files downloaded for them: {len(downloaded):,} "
        f"(for {len(files):,} candidacies)",
        f"  cut: {len(done):,} ({_counts(Counter(cuts[sha].status for sha in done))})",
        f"  not cut yet: {len(downloaded - done):,}",
        f"  crops (pages with the date's line): {len(pages):,} ({_counts(sorts)})",
        f"  crops on the site: {on_site:,}, not sent {len(pages) - on_site:,}",
    ]
    skipped = Counter(r.reason for r in extracts_sent.values() if r.result != "stored")
    if skipped:
        lines.append(f"  extracts the site skipped: {_counts(skipped)}")

    def reached(row: PersonRow, stage: str) -> bool:
        """One of the candidacy's files got this far."""
        for sha in files.get(row.key, ()):
            if stage == "downloaded":
                return True
            if sha not in done:
                continue
            if stage == "cut":
                return True
            if stage == "crop" and crops.get(sha):
                return True
            if stage == "crop sent" and any(
                extract_id(sha, page) in stored for page in crops.get(sha, [])
            ):
                return True
        return False

    stages = ("downloaded", "cut", "crop", "crop sent")
    head = ("all", "found", "unconf", *stages, "cand sent")
    lines += [
        "",
        "by priority (candidacies)",
        f"  {'':16}" + "".join(f"{h:>11}" for h in head),
    ]
    for priority in sorted({row.priority for row in people}):
        rows = [row for row in people if row.priority == priority]
        figures = (
            len(rows),
            sum(row.status == "found" for row in rows),
            sum(row.status == "unconfirmed" for row in rows),
            *(sum(reached(row, stage) for row in rows) for stage in stages),
            sum(
                candidacies_sent[row.key].result == "stored"
                for row in rows
                if row.key in candidacies_sent
            ),
        )
        name = f"{priority} {PRIORITIES.get(priority, '')}"
        lines.append(f"  {name:16}" + "".join(f"{n:>11,}" for n in figures))
    lines += [
        "  downloaded to crop sent: one of the candidacy's files got that far, and a",
        "  council's file counts for everybody in it; cand sent: the candidacy itself",
    ]

    empty = empty_units(people, files)
    empty_teryts = {u.teryt for u in empty}
    in_empty = [row for row in people if row.unit in empty_teryts]
    units_of = {row.unit for row in people}
    no_found = (
        units_of - empty_teryts - {row.unit for row in people if row.status == "found"}
    )
    lines += [
        "",
        f"units (TERYT) with nothing downloaded: {len(empty):,} of {len(units_of):,}, "
        f"holding {len(in_empty):,} candidacies",
        f"  another {len(no_found):,} have files but no candidacy found",
        f"  by level: {_counts(Counter(u.level for u in empty))}",
        f"  outcomes: {_counts(outcomes(in_empty))}",
        "  by priority: "
        + _counts(
            Counter(f"{r.priority} {PRIORITIES.get(r.priority, '')}" for r in in_empty)
        ),
        "  by election year: "
        + _counts(Counter(str(r.election_year) for r in in_empty)),
        "  by voivodeship: "
        + _counts(Counter(VOIVODESHIPS.get(r.unit[:2], r.unit[:2]) for r in in_empty)),
    ]
    if units and empty:
        lines += [
            "",
            f"  the biggest {min(units, len(empty))}:",
            f"  {'teryt':8} {'cands':>5} {'site':>4}  unit: outcomes",
        ]
        lines += [
            f"  {u.teryt:8} {u.candidacies:>5} {u.on_site:>4}  "
            f"{u.name}: {_counts(u.outcomes)}"
            for u in empty[:units]
        ]
    return lines, empty


def write_units_csv(path: Path, units: list[EmptyUnit]) -> None:
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(
            ["teryt", "unit_name", "unit_level", "candidacies", "on_site", "outcomes"]
        )
        for u in units:
            writer.writerow(
                [
                    u.teryt,
                    u.name,
                    u.level,
                    u.candidacies,
                    u.on_site,
                    _counts(u.outcomes),
                ]
            )
