"""What `extract_people` makes of a company crawled more than once."""

import collections
import json

import pandas as pd
import pytest

from scrapers.krs.list import (
    CompaniesKRS,
    extract_people,
    is_owned_by_queried,
    posts_held,
)
from scrapers.stores import Context, ProcessPolicy
from scrapers.stores.file import DownloadableFile, latest_crawls
from scrapers.test_tree import MockIO, MockNLP, MockRejestrIO, MockUtils, MockWeb

BUCKET = "gs://koryta-pl-crawled"


# One person, one supervisory board seat that began in 2007.
def seat(start: str, end: str | None) -> dict:
    return {
        "typ": "osoba",
        "id": 911114,
        "tozsamosc": {
            "imie": "Marek",
            "nazwisko": "Staniszewski",
            "imiona_i_nazwisko": "Marek Staniszewski",
            "data_urodzenia": "1958-04-11",
        },
        "krs_powiazania_kwerendowane": [
            {"typ": "KRS_SUPERVISION", "data_start": start, "data_koniec": end}
        ],
    }


class FakeFile:
    def __init__(self, content: str):
        self.content = content

    def read_string(self) -> str:
        return self.content


class BucketIO(MockIO):
    """Serves a fixed set of blobs, so a listing can be crawl-dated at will.

    ``read_many`` hands back everything under the prefix in insertion order,
    which is what both of its real implementations do - the compressed mirror
    walks an archive, the fallback walks a listing - and neither promises the
    crawls of one query arrive together or in date order. Tests therefore
    control arrival order by the order they build the dict in.
    """

    def __init__(self, blobs: dict[str, list | str]):
        self.blobs = blobs
        self.read: list[str] = []

    def list_files(self, path):
        for name in self.blobs:
            # Sized, as a GCS listing is: a caller that needs to tell a failed
            # crawl from a real one should not have to download it to find out.
            yield DownloadableFile(
                f"{BUCKET}/{name}", size=len(self._body(name).encode())
            )

    def read_data(self, fs):
        name = fs.url.removeprefix(f"{BUCKET}/")
        self.read.append(name)
        return FakeFile(self._body(name))

    def read_many(self, path):
        for name in self.blobs:
            self.read.append(name)
            yield f"{BUCKET}/{name}", FakeFile(self._body(name))

    def _body(self, name: str) -> str:
        blob = self.blobs[name]
        # A crawl that failed is stored as an empty object, not as empty JSON.
        return blob if isinstance(blob, str) else json.dumps(blob)


@pytest.fixture
def context():
    def build(blobs: dict[str, list | str]) -> tuple[Context, BucketIO]:
        io = BucketIO(blobs)
        return (
            Context(
                io=io,
                rejestr_io=MockRejestrIO(),
                con=None,  # type: ignore[arg-type]
                utils=MockUtils(),
                web=MockWeb(),
                nlp=MockNLP(),
                refresh_policy=ProcessPolicy.with_default(),
            ),
            io,
        )

    return build


def connections(krs: str, aktualnosc: str, date: str) -> str:
    return (
        f"hostname=rejestr.io/api/v2/org/{krs}/krs-powiazania"
        f"/aktualnosc_{aktualnosc}/date={date}"
    )


def test_one_seat_crawled_four_times_is_one_row(context):
    """The bug this guards: four crawls used to mean four spells of employment.

    Each crawl keeps its own blob, and the seat looks different in each - open
    while it was held, closed once it ended - so reading them all reported one
    person as both still on the board and long gone.
    """
    ctx, _ = context(
        {
            connections("0000030563", "aktualne", "2026-02-13"): [
                seat("2007-10-16", None)
            ],
            connections("0000030563", "aktualne", "2026-05-27"): [
                seat("2007-10-16", None)
            ],
            connections("0000030563", "aktualne", "2026-07-19"): [
                seat("2007-10-16", "2026-07-07")
            ],
        }
    )

    people = extract_people(ctx)

    assert len(people) == 1
    assert people.iloc[0]["employed_start"] == "2007-10-16"
    assert people.iloc[0]["employed_end"] == "2026-07-07"


@pytest.mark.parametrize("newest_first", [False, True])
def test_the_newest_crawl_wins_whichever_order_it_arrives_in(context, newest_first):
    """Nothing orders the blobs, so the answer cannot depend on their order.

    The crawls used to be sorted by a listing before anything was read. They now
    arrive from `read_many` in whatever order the compressed archive holds them,
    so the newest has to win on its `date=` alone.
    """
    older = (
        connections("0000030563", "aktualne", "2026-02-13"),
        [seat("2007-10-16", None)],
    )
    newer = (
        connections("0000030563", "aktualne", "2026-07-19"),
        [seat("2007-10-16", "2026-07-07")],
    )
    arriving = [newer, older] if newest_first else [older, newer]
    ctx, _ = context(dict(arriving))

    people = extract_people(ctx)

    assert len(people) == 1
    assert people.iloc[0]["employed_end"] == "2026-07-07"


def test_current_and_historical_seats_are_both_kept(context):
    """A past seat and a present one at the same company are two real spells."""
    ctx, _ = context(
        {
            connections("0000030563", "aktualne", "2026-07-19"): [
                seat("2020-01-01", None)
            ],
            connections("0000030563", "historyczne", "2026-07-19"): [
                seat("2007-10-16", "2011-06-30")
            ],
        }
    )

    people = extract_people(ctx)

    assert sorted(people["employed_start"]) == ["2007-10-16", "2020-01-01"]


def test_blobs_that_are_not_connection_queries_contribute_nothing(context):
    """`read_many` returns the whole hostname, not just the connection queries.

    Company profiles, the `osoby` lookups and anything else crawled off
    rejestr.io arrive on the same prefix. They are somebody's data too, so the
    filter has to be on the name rather than on whether the body parses.
    """
    ctx, _ = context(
        {
            "hostname=rejestr.io/api/v2/org/0000030563/date=2026-07-19": [
                seat("1999-01-01", None)
            ],
            connections("0000030563", "aktualne", "2026-07-19"): [
                seat("2007-10-16", None)
            ],
        }
    )

    people = extract_people(ctx)

    assert list(people["employed_start"]) == ["2007-10-16"]


def test_an_empty_newest_crawl_falls_back_to_the_crawl_before_it(context):
    """A failed fetch costs one crawl, not the company.

    An empty object is how a failed crawl is stored. Nothing is recorded for it,
    so the crawl before it stands - which is the whole reason the newest crawl
    is picked from what arrives rather than named from a listing.
    """
    ctx, _ = context(
        {
            connections("0000030563", "aktualne", "2026-02-13"): [
                seat("2007-10-16", None)
            ],
            connections("0000030563", "aktualne", "2026-07-19"): "",
        }
    )

    people = extract_people(ctx)

    assert len(people) == 1
    assert people.iloc[0]["employed_start"] == "2007-10-16"


# --------------------------------------------------------------------------- #
# what rejestr.io's connection types mean                                      #
# --------------------------------------------------------------------------- #


def person(*connections: dict) -> dict:
    return {
        "typ": "osoba",
        "id": 1387745,
        "tozsamosc": {"imiona_i_nazwisko": "Krystyna Rozalia Gryglas"},
        "krs_powiazania_kwerendowane": list(connections),
    }


def connection(typ: str, start: str | None = "2001-01-01", end: str | None = None):
    return {"typ": typ, "data_start": start, "data_koniec": end}


def test_a_board_seat_and_a_later_proxy_are_two_posts():
    """The spell they used to be collapsed into was neither of them.

    Krystyna Gryglas was on the board of KRS 0000076251 for twenty months and
    its prokurent for the five years after that. Taking the earliest start and
    the latest end of the two made her a board member for seven years.
    """
    posts = posts_held(
        person(
            connection("KRS_BOARD", "2001-12-27", "2003-08-04"),
            connection("KRS_PROXY", "2003-08-04", "2008-08-29"),
        )
    )

    assert [(p.role, p.start, p.end) for p in posts] == [
        ("Zarząd", "2001-12-27", "2003-08-04"),
        ("Prokurent", "2003-08-04", "2008-08-29"),
    ]


@pytest.mark.parametrize(
    ("typ", "role"),
    [
        ("KRS_BOARD", "Zarząd"),
        ("KRS_SUPERVISION", "Rada Nadzorcza"),
        # Named the opposite way round from how they read - see
        # KRS_RELATION_ROLES for the two register entries this was checked
        # against.
        ("KRS_PROXY", "Prokurent"),
        ("KRS_PROCURATOR", "Pełnomocnik"),
    ],
)
def test_every_kind_of_post_says_which_one_it_is(typ, role):
    assert [p.role for p in posts_held(person(connection(typ)))] == [role]


@pytest.mark.parametrize(
    "typ",
    [
        "KRS_SHAREHOLDER",
        "KRS_ONLY_SHAREHOLDER",
        "BENEFICIARY",
        "KRS_FOUNDER",
        "KRS_RECEIVER",
        "KRS_CURATOR",
        "KRS_COMMISSIONER",
        "KRS_RESTRUCTURIZATOR",
    ],
)
def test_owning_a_company_or_being_put_over_it_is_not_a_job(typ):
    """These used to be published as employment with no role and a stray date.

    Tadeusz Krupiński left the board of ESV9 on 2026-06-19 and became its
    prokurent the same day. The proxy registration was written as a nameless
    job starting that day, so the company he had just left showed up among the
    ones he had just joined.
    """
    assert posts_held(person(connection(typ))) == []


def test_an_unclassified_connection_is_counted_not_guessed():
    unknown: collections.Counter[str] = collections.Counter()

    assert posts_held(person(connection("KRS_SOMETHING_NEW")), unknown) == []
    assert unknown == {"KRS_SOMETHING_NEW": 1}


def test_an_open_post_is_measured_up_to_today():
    [post] = posts_held(person(connection("KRS_BOARD", "2020-01-01", None)))

    assert float(post.years) > 5


def test_a_closed_post_is_measured_by_its_own_dates():
    """Not by the span of everything the person ever did at the company."""
    posts = posts_held(
        person(
            connection("KRS_BOARD", "2001-12-27", "2003-08-04"),
            connection("KRS_PROXY", "2003-08-04", "2008-08-29"),
        )
    )

    assert [p.years for p in posts] == ["1.60", "5.07"]


# ─── the second person shape ───────────────────────────────


def unidentified_seat(start: str, end: str | None) -> dict:
    """A person rejestr.io holds no PESEL for: a name, and nothing else.

    No `data_urodzenia`, no `plec` - which is exactly how the real entries
    arrive, all 6,606 of them.
    """
    return {
        "typ": "osoba-bez-pesel",
        "id": 2906389,
        "tozsamosc": {
            "imie": "Jerzy",
            "nazwisko": "Gibas",
            "imiona_i_nazwisko": "Jerzy Gibas",
            "drugie_imiona": "",
        },
        "krs_powiazania_kwerendowane": [
            {"typ": "KRS_SUPERVISION", "data_start": start, "data_koniec": end}
        ],
    }


def test_a_person_without_a_pesel_is_still_a_person(context):
    """The bug this guards: 3,912 people held 6,227 seats nothing could see.

    `people_to_scrape` reads this pipeline to decide whose rejestr.io feed to
    buy, and `companies_without_names` reads it to find companies at all, so
    dropping them hid both the people and their companies from the scraper.
    """
    ctx, _ = context(
        {
            connections("0000030563", "aktualne", "2026-02-13"): [
                unidentified_seat("2007-10-16", None)
            ]
        }
    )

    people = extract_people(ctx)

    assert len(people) == 1
    assert people.iloc[0]["full_name"] == "Jerzy Gibas"
    assert people.iloc[0]["rejestrio_type"] == "osoba-bez-pesel"


def test_the_shape_is_recorded_rather_than_guessed_from_the_empty_fields(context):
    ctx, _ = context(
        {
            connections("0000030563", "aktualne", "2026-02-13"): [
                seat("2007-10-16", None),
                unidentified_seat("2010-01-01", None),
            ]
        }
    )

    people = extract_people(ctx)

    assert set(people["rejestrio_type"]) == {"osoba", "osoba-bez-pesel"}
    unidentified = people[people["rejestrio_type"] == "osoba-bez-pesel"]
    assert pd.isna(unidentified.iloc[0]["birth_date"])


def test_an_organisation_is_still_not_a_person(context):
    ctx, _ = context(
        {
            connections("0000030563", "aktualne", "2026-02-13"): [
                {"typ": "organizacja", "id": 1, "numery": {"krs": "0000000001"}}
            ]
        }
    )

    assert extract_people(ctx).empty


# ─── a failed crawl must not lose the company ──────────────


def org(krs: str, date: str) -> str:
    return f"hostname=rejestr.io/api/v2/org/{krs}/date={date}"


def test_a_failed_newest_crawl_falls_back_to_the_last_good_one(context):
    """The bug this guards: the company disappeared instead.

    `iterate_blobs` took the newest crawl and only then noticed it was the
    zero-byte marker a failed fetch leaves, so a company whose last fetch
    failed lost its name, NIP, REGON, seat and owners entirely.
    """
    ctx, _ = context(
        {
            org("0000030563", "2026-02-13"): {
                "nazwy": {"skrocona": "DOBRA"},
                "numery": {"krs": "0000030563"},
                "typ": "organizacja",
            },
            org("0000030563", "2026-07-19"): "",
        }
    )

    seen = [name for name, _ in CompaniesKRS().iterate_blobs(ctx, "rejestr.io")]

    assert seen == [f"{BUCKET}/{org('0000030563', '2026-02-13')}"]


def test_the_newest_good_crawl_is_still_the_one_used(context):
    ctx, _ = context(
        {
            org("0000030563", "2026-02-13"): {"numery": {"krs": "0000030563"}},
            org("0000030563", "2026-07-19"): {"numery": {"krs": "0000030563"}},
        }
    )

    seen = [name for name, _ in CompaniesKRS().iterate_blobs(ctx, "rejestr.io")]

    assert seen == [f"{BUCKET}/{org('0000030563', '2026-07-19')}"]


def test_the_newest_crawl_wins_whichever_arrives_first(context):
    ctx, _ = context(
        {
            org("0000030563", "2026-07-19"): {"numery": {"krs": "0000030563"}},
            org("0000030563", "2026-02-13"): {"numery": {"krs": "0000030563"}},
        }
    )

    seen = [name for name, _ in CompaniesKRS().iterate_blobs(ctx, "rejestr.io")]

    assert seen == [f"{BUCKET}/{org('0000030563', '2026-07-19')}"]


def test_companies_come_out_in_listing_order_whatever_the_arrival_order(context):
    """`add_company` keeps the first non-empty value of each field, so the
    order decides between two crawls that disagree. A mirror serves its
    archive first and what it lacks after, so arrival order moves with the
    mirror's age; the output must not."""
    ctx, _ = context(
        {
            org("0000000002", "2026-09-27"): {"numery": {"krs": "0000000002"}},
            org("0000000001", "2026-07-19"): {"numery": {"krs": "0000000001"}},
        }
    )

    seen = [name for name, _ in CompaniesKRS().iterate_blobs(ctx, "rejestr.io")]

    assert seen == [
        f"{BUCKET}/{org('0000000001', '2026-07-19')}",
        f"{BUCKET}/{org('0000000002', '2026-09-27')}",
    ]


def odpis(krs: str, date: str, layout: str) -> str:
    """An api-krs crawl, under either place the bucket has kept its date."""
    if layout == "date-first":
        return f"hostname=api-krs.ms.gov.pl/date={date}/api/krs/OdpisAktualny/{krs}"
    return f"hostname=api-krs.ms.gov.pl/api/krs/OdpisAktualny/{krs}/date={date}"


@pytest.mark.parametrize("reverse", [False, True], ids=["listing", "reversed"])
def test_crawls_come_out_in_the_order_a_listing_gives_them(context, reverse):
    """A query crawled under both layouts sorts under each in a different place.

    Ordering by the newest crawl's own name put 0000028428 among the
    date-first names, where on 2026-09-28 a listing had it among the others:
    same crawls chosen, 20,999 of them, in a different order.
    """
    crawls: dict[str, dict | str] = {
        odpis("0000028428", "2025-09-01", "date-last"): {"a": 1},
        odpis("0000028428", "2025-10-27", "date-first"): {"a": 2},
        odpis("0000033577", "2025-10-27", "date-first"): {"a": 3},
        odpis("0000005790", "2025-10-27", "date-first"): {"a": 4},
        # A failed crawl is not where a listing meets its query.
        odpis("0000046134", "2026-02-01", "date-last"): "",
        odpis("0000046134", "2025-10-27", "date-first"): {"a": 5},
    }
    arrival = sorted(crawls, reverse=reverse)
    ctx, _ = context({name: crawls[name] for name in arrival})
    listing = sorted(name for name, body in crawls.items() if body != "")

    seen = [name for name, _ in CompaniesKRS().iterate_blobs(ctx, "api-krs.ms.gov.pl")]

    assert seen == [f"{BUCKET}/{n}" for n in latest_crawls(listing, lambda n: n)]


# ─── who owns whom ─────────────────────────────────────────


def tie(*types: str) -> dict:
    """A company tied to the queried one by these connections, in this order."""
    return {
        "typ": "organizacja",
        "krs_powiazania_kwerendowane": [
            {
                "typ": t,
                "kierunek": "PASYWNY" if t == "KRS_SHAREHOLDER" else "AKTYWNY",
            }
            for t in types
        ],
    }


@pytest.mark.parametrize(
    "types",
    [("KRS_SHAREHOLDER",), ("KRS_BOARD", "KRS_SHAREHOLDER")],
    ids=["shareholding-alone", "shareholding-behind-a-board-seat"],
)
def test_a_shareholding_is_ownership_wherever_it_is_listed(types):
    """The bug this guards: only the first connection was looked at.

    Five companies in the crawl list a board seat before the shareholding, and
    lost the ownership edge that `propagate_is_public` walks.
    """
    assert is_owned_by_queried(tie(*types))


def test_a_board_seat_alone_is_not_ownership():
    assert not is_owned_by_queried(tie("KRS_BOARD"))


def test_an_entry_with_no_connections_is_not_owned():
    assert not is_owned_by_queried({"typ": "organizacja"})


PERSON_FEED = (
    "hostname=rejestr.io/api/v2/osoby/808738/krs-powiazania"
    "/aktualnosc_aktualne/date=2026-07-19"
)


def test_a_persons_own_feed_contributes_nothing_here(context):
    """It lists companies, not people, so it never could have.

    4,198 such documents were being parsed for no rows at all. What is in them
    is used elsewhere - to find companies worth crawling, and to tell whether
    the feed itself has gone stale.
    """
    ctx, _ = context(
        {PERSON_FEED: [{"typ": "organizacja", "numery": {"krs": "0000030563"}}]}
    )

    assert extract_people(ctx).empty


def test_a_company_feed_alongside_one_is_still_read(context):
    ctx, _ = context(
        {
            PERSON_FEED: [{"typ": "organizacja", "numery": {"krs": "0000030563"}}],
            connections("0000030563", "aktualne", "2026-02-13"): [
                seat("2007-10-16", None)
            ],
        }
    )

    assert len(extract_people(ctx)) == 1
