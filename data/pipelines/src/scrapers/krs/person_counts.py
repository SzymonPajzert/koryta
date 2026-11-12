"""rejestr.io's own count of each person's KRS connections, off the company
feeds already bought.

Every `osoba` a company's krs-powiazania feed lists carries
`krs_powiazania_liczby`: how many connections rejestr.io holds for that person
across the register - `aktualne` current ones, at `aktualne_organizacje`
organisations, and `przeszle` past ones. Those are what the person's own feeds
list, `aktualne` the ``?aktualnosc=aktualne`` one and `przeszle` the
``?aktualnosc=historyczne`` one, so the count says before a purchase what the
purchase would bring. Of the 599 person feeds bought from 2026-10-06 to 11-06,
585 had a count from before the purchase, and it matched what they listed:
correlation 0.957, the median off by 0, 93% within 2.

It is free: it comes with every company feed already in the crawl bucket. The
paid job ranks the person feeds it buys by it (`jobs.krs_scrape_paid.plan`).

A person turns up in the feed of every company they are tied to, each crawled
on its own day, and rejestr.io's count moves with the register, so the newest
crawl's word stands. Entries without a PESEL carry no count, and their numbers
are not the osoba's of that number (`scrapers.krs.list.PERSON_TYPES`): only an
`osoba` is read.
"""

import dataclasses
import json
import typing

import pandas as pd

from scrapers.krs.list import OSOBA
from scrapers.stores import CloudStorage, Context, Pipeline
from scrapers.stores.file import split_crawl_date


@dataclasses.dataclass(frozen=True)
class PersonCount:
    """rejestr.io's count of one person's connections, as one company feed
    stated it."""

    #: The rejestr.io person id, as `RejestrIOKey` spells it.
    id: str
    aktualne: int
    aktualne_organizacje: int
    przeszle: int
    #: The day of the crawl that said so, and the company whose feed it was.
    counted_on: str
    krs: str

    @property
    def stated(self) -> int:
        """Every connection counted, current and past: what the person's two
        feeds list between them."""
        return self.aktualne + self.przeszle


COLUMNS = [field.name for field in dataclasses.fields(PersonCount)]


def parse_company_connections_url(url: str) -> tuple[str, str] | None:
    """``(krs, crawl date)`` for a company's krs-powiazania feed, current or
    past; None for anything else under the host."""
    path, crawl_date = split_crawl_date(url)
    if "/org/" not in path or "krs-powiazania" not in path:
        return None
    krs = path.split("/org/", 1)[1].split("/", 1)[0]
    if not krs.isdigit():
        return None
    return krs.zfill(10), crawl_date


def as_count(value: typing.Any) -> int | None:
    """A number rejestr.io counted, or None for anything else - bool too,
    which is an int to Python and no count."""
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def counts_in(data: typing.Any, krs: str, day: str) -> typing.Iterator[PersonCount]:
    """The count of every `osoba` one company feed lists."""
    for item in data if isinstance(data, list) else []:
        if not isinstance(item, dict) or item.get("typ") != OSOBA:
            continue
        stated = item.get("krs_powiazania_liczby")
        person = item.get("id")
        if not isinstance(stated, dict) or person is None:
            continue
        aktualne = as_count(stated.get("aktualne"))
        organizacje = as_count(stated.get("aktualne_organizacje"))
        przeszle = as_count(stated.get("przeszle"))
        if aktualne is None or organizacje is None or przeszle is None:
            continue
        yield PersonCount(
            id=str(person),
            aktualne=aktualne,
            aktualne_organizacje=organizacje,
            przeszle=przeszle,
            counted_on=day,
            krs=krs,
        )


def newest_counts(counts: typing.Iterable[PersonCount]) -> dict[str, PersonCount]:
    """Each person's count from the newest crawl that states one.

    Two feeds crawled the same day can disagree, a connection having ended
    between the two calls; the higher count is taken, then the higher KRS
    number, so that the answer does not depend on the order the bucket hands
    the feeds over in.
    """

    def newer(count: PersonCount) -> tuple[str, int, str]:
        return count.counted_on, count.stated, count.krs

    newest: dict[str, PersonCount] = {}
    for count in counts:
        seen = newest.get(count.id)
        if seen is None or newer(count) > newer(seen):
            newest[count.id] = count
    return newest


def read_counts(frame: pd.DataFrame | None) -> dict[str, PersonCount]:
    """`RejestrIOPersonCounts`'s output as the paid job reads it: each
    person's count under their rejestr.io id."""
    if frame is None or frame.empty:
        return {}
    return {
        str(row["id"]): PersonCount(
            id=str(row["id"]),
            aktualne=int(row["aktualne"]),
            aktualne_organizacje=int(row["aktualne_organizacje"]),
            przeszle=int(row["przeszle"]),
            counted_on=str(row["counted_on"]),
            krs=str(row["krs"]).zfill(10),
        )
        for row in frame.to_dict("records")
    }


class RejestrIOPersonCounts(Pipeline):
    """rejestr.io's newest count of every person a company feed we hold lists:
    one row a person.

    Reads the crawl bucket and nothing else, so nothing tells it a feed has
    been bought since: the paid job names it in its refresh policy.
    """

    filename = "rejestrio_person_counts"
    dtype = {"id": str, "krs": str, "counted_on": str}

    def process(self, ctx: Context) -> pd.DataFrame:
        feeds = 0

        def counted() -> typing.Iterator[PersonCount]:
            nonlocal feeds
            for name, blob in ctx.io.read_many(
                CloudStorage(prefix="hostname=rejestr.io")
            ):
                parsed = parse_company_connections_url(name)
                if parsed is None:
                    continue
                content = blob.read_string()
                if content == "":
                    # A failed fetch, as `extract_people` reads one: it says
                    # nothing, and an older crawl's word stands.
                    continue
                try:
                    data = json.loads(content)
                except json.JSONDecodeError as e:
                    print(f"  [WARN] Could not read {name}: {e}")
                    continue
                feeds += 1
                yield from counts_in(data, *parsed)

        newest = newest_counts(counted())
        print(
            f"rejestr.io's own counts: {len(newest)} people, from {feeds} company feeds"
        )
        rows = [dataclasses.asdict(newest[person]) for person in sorted(newest)]
        return pd.DataFrame(rows, columns=COLUMNS)
