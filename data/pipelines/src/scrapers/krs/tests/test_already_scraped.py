"""What counts as a company having been scraped."""

import pandas as pd

from scrapers.krs.scrape import (
    KRSAlreadyScraped,
    KRSScraped,
    QueryType,
    ScrapeRejestrIO,
    api_krs_register,
)
from scrapers.stores import Context, ProcessPolicy
from scrapers.stores.file import DownloadableFile
from scrapers.test_tree import MockIO, MockNLP, MockRejestrIO, MockUtils, MockWeb

BUCKET = "gs://koryta-pl-crawled"
KRS = "0000000110"


def odpis(register: str, day: str) -> str:
    return (
        f"hostname=api-krs.ms.gov.pl/api/krs/OdpisAktualny/{KRS}"
        f"/?rejestr={register}/date={day}"
    )


class ListingIO(MockIO):
    """Serves a listing that knows each object's size, as GCS does."""

    def __init__(self, blobs: dict[str, int | None]):
        self.blobs = blobs

    def list_files(self, path):
        for name, size in self.blobs.items():
            if name.startswith(path.prefix):
                yield DownloadableFile(f"{BUCKET}/{name}", size=size)


def scraped(blobs) -> pd.DataFrame:
    ctx = Context(
        io=ListingIO(blobs),
        rejestr_io=MockRejestrIO(),
        con=None,  # type: ignore[arg-type]
        utils=MockUtils(),
        web=MockWeb(),
        nlp=MockNLP(),
        refresh_policy=ProcessPolicy.with_default(),
    )
    return KRSAlreadyScraped().process(ctx)


# ─── which register was asked ─────────────────────────────


def test_the_two_free_queries_are_told_apart():
    """Recording both as P left the S query looking unasked, for ever."""
    assert api_krs_register(odpis("P", "2026-07-18")) == (
        QueryType.API_KRS_ODPIS_AKTUALNY_P
    )
    assert api_krs_register(odpis("S", "2026-07-18")) == (
        QueryType.API_KRS_ODPIS_AKTUALNY_S
    )


def test_a_blob_from_before_the_parameter_existed_counts_as_the_p_query():
    older = f"hostname=api-krs.ms.gov.pl/api/krs/OdpisAktualny/{KRS}/date=2026-02-13"

    assert api_krs_register(older) == QueryType.API_KRS_ODPIS_AKTUALNY_P


def test_both_registers_reach_the_output():
    df = scraped({odpis("P", "2026-07-18"): 4096, odpis("S", "2026-07-18"): 512})

    assert set(df["method"]) == {
        QueryType.API_KRS_ODPIS_AKTUALNY_P.value,
        QueryType.API_KRS_ODPIS_AKTUALNY_S.value,
    }


# ─── a failed crawl is not a scrape ───────────────────────


def test_a_zero_byte_failure_marker_is_not_a_scrape():
    """The bug this guards: 1,052 subjects looked done and were never retried."""
    df = scraped({odpis("P", "2026-07-18"): 0})

    assert df.empty


def test_a_company_whose_only_crawl_failed_is_not_recorded():
    df = scraped({odpis("P", "2026-07-18"): 0, odpis("S", "2026-07-18"): 0})

    assert df.empty


def test_a_later_good_crawl_still_counts():
    df = scraped({odpis("P", "2026-07-18"): 0, odpis("P", "2026-07-19"): 4096})

    assert list(df["date"]) == ["2026-07-19"]


def test_a_reference_whose_size_is_unknown_is_kept():
    """Unknown is not empty - only a listing that carries sizes can say."""
    df = scraped({odpis("P", "2026-07-18"): None})

    assert len(df) == 1


# ─── which registers answered 404 ─────────────────────────

NOT_FOUND = (
    '{"type": "https://tools.ietf.org/html/rfc7231#section-6.5.4",'
    ' "title": "Not Found", "status": 404, "traceId": "00-a1-d9-00"}'
)


class Body:
    """A stored object, as IO hands it over."""

    def __init__(self, text: str):
        self.text = text

    def read_string(self) -> str:
        return self.text


class BodiesIO(ListingIO):
    """Serves the bodies through read_many, as the mirror does, or not at all,
    and counts what had to be read one object at a time."""

    def __init__(self, blobs: dict[str, int | None], bodies: dict[str, str], bulk):
        super().__init__(blobs)
        self.bodies = bodies
        self.bulk = bulk
        self.one_by_one: list[str] = []

    def read_many(self, path):
        for name in self.bulk:
            if name.startswith(path.prefix):
                yield f"{BUCKET}/{name}", Body(self.bodies[name])

    def read_data(self, fs):
        self.one_by_one.append(fs.url)
        return Body(self.bodies[fs.url.removeprefix(f"{BUCKET}/")])


def not_found(bodies: dict[str, str], bulk=None) -> tuple[dict[str, bool], list]:
    """`not_found` per register, and what was read one by one."""
    blobs: dict[str, int | None] = {name: len(body) for name, body in bodies.items()}
    io = BodiesIO(blobs, bodies, bodies if bulk is None else bulk)
    ctx = Context(
        io=io,
        rejestr_io=MockRejestrIO(),
        con=None,  # type: ignore[arg-type]
        utils=MockUtils(),
        web=MockWeb(),
        nlp=MockNLP(),
        refresh_policy=ProcessPolicy.with_default(),
    )
    df = KRSAlreadyScraped().process(ctx)
    return dict(zip(df["method"], df["not_found"])), io.one_by_one


def test_the_404s_come_from_the_bulk_read():
    """One read_data each was 14,439 GETs in a row on a fresh disk."""
    entry = '{"odpis": {"naglowekA": {"rejestr": "RejP"}}}' + " " * 1800
    found, one_by_one = not_found(
        {odpis("P", "2026-07-18"): NOT_FOUND, odpis("S", "2026-07-18"): entry}
    )

    assert found == {
        QueryType.API_KRS_ODPIS_AKTUALNY_P.value: True,
        QueryType.API_KRS_ODPIS_AKTUALNY_S.value: False,
    }
    assert one_by_one == []


def test_what_the_bulk_read_does_not_hand_over_is_read_one_by_one():
    """Missing from the bulk read is not the same as not a 404."""
    found, one_by_one = not_found({odpis("P", "2026-07-18"): NOT_FOUND}, bulk={})

    assert found == {QueryType.API_KRS_ODPIS_AKTUALNY_P.value: True}
    assert one_by_one == [f"{BUCKET}/{odpis('P', '2026-07-18')}"]


def test_the_bulletin_is_not_a_company_scrape():
    df = scraped(
        {"hostname=api-krs.ms.gov.pl/api/Krs/Biuletyn/2026-07-18/date=2026-07-18": 900}
    )

    assert df.empty


def test_a_rejestrio_response_is_read_the_same_way():
    blob = (
        f"hostname=rejestr.io/api/v2/org/{KRS}/krs-powiazania"
        "/aktualnosc_aktualne/date=2026-07-19"
    )

    assert KRSScraped.parse(blob).method == (
        QueryType.REJESTRIO_ORG_KRS_POWIAZANIA_AKTUALNE
    )
    assert scraped({blob: 0}).empty


# ─── companies with connections but no register entry ──────


def rejestrio(krs: str, day: str, kind: str = "aktualne") -> str:
    return (
        f"hostname=rejestr.io/api/v2/org/{krs}/krs-powiazania"
        f"/aktualnosc_{kind}/date={day}"
    )


def missing_register_entries(blobs, named: tuple[str, ...] = ()) -> set[str]:
    """What `companies_without_register_entry` asks for, given these blobs.

    `named` are the companies `CompaniesKRS` knows, blob or not - a feed
    naming a company is enough to put it there.
    """
    ctx = Context(
        io=ListingIO(blobs),
        rejestr_io=MockRejestrIO(),
        con=None,  # type: ignore[arg-type]
        utils=MockUtils(),
        web=MockWeb(),
        nlp=MockNLP(),
        refresh_policy=ProcessPolicy.with_default(),
    )
    scraped = KRSAlreadyScraped().process(ctx)
    pipeline = ScrapeRejestrIO()
    already = pipeline.already_scraped
    already.read_or_process = lambda _ctx: scraped  # type: ignore[assignment]
    companies = pipeline.companies
    companies.read_or_process = lambda _ctx: pd.DataFrame(  # type: ignore[assignment]
        {"krs": list(named)}, dtype=str
    )
    return {krs.id for krs in pipeline.companies_without_register_entry(ctx)}


def test_a_company_met_only_through_rejestrio_is_asked_for_its_entry():
    """Nothing can check a response with no register entry to check against."""
    assert missing_register_entries({rejestrio(KRS, "2026-07-19"): 4096}) == {KRS}


def test_a_company_we_already_have_an_entry_for_is_not_asked_again():
    assert (
        missing_register_entries(
            {rejestrio(KRS, "2026-07-19"): 4096, odpis("P", "2026-07-18"): 4096}
        )
        == set()
    )


def test_a_company_whose_entry_query_only_ever_failed_is_asked_again():
    """The empty marker is not an entry, so it does not count as one."""
    assert missing_register_entries(
        {rejestrio(KRS, "2026-07-19"): 4096, odpis("P", "2026-07-18"): 0}
    ) == {KRS}


def test_a_company_with_only_a_register_entry_is_not_queued_for_a_paid_query():
    """That direction is 1,642 companies and 164 PLN - a decision, not a fix."""
    assert missing_register_entries({odpis("P", "2026-07-18"): 4096}) == set()


def test_a_company_a_feed_only_names_is_asked_for_its_entry():
    """No blob of its own, so nothing says who owns it until the odpis does."""
    another = odpis("P", "2026-07-18").replace(KRS, "0000000111")

    assert missing_register_entries({another: 4096}, named=(KRS,)) == {KRS}


def test_a_named_company_with_an_entry_is_not_asked_again():
    assert (
        missing_register_entries({odpis("P", "2026-07-18"): 4096}, named=(KRS,))
        == set()
    )
