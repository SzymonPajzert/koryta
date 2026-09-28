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


def over(df: pd.DataFrame) -> KRSAlreadyScraped:
    """The pipeline, reading `df` as its output."""
    pipeline = KRSAlreadyScraped()
    pipeline.read_or_process = lambda _ctx: df  # type: ignore[assignment]
    return pipeline


def answered(blobs) -> pd.DataFrame:
    """What the pipeline holds as answers: its output less the empty crawls."""
    return over(scraped(blobs)).answered(None)  # type: ignore[arg-type]


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


def test_a_full_extract_is_its_own_query():
    """Asked only for a company with no name, and only once - which is what
    recording it here is for. It used to raise instead: the parser looked for
    "OdpisAktualny/" in every api-krs path."""
    full = odpis("P", "2026-09-28").replace("OdpisAktualny", "OdpisPelny")

    assert api_krs_register(full) == QueryType.API_KRS_ODPIS_PELNY_P
    df = answered({full: 180_000, odpis("P", "2026-07-18"): 0})

    assert list(df["krs"]) == [KRS]
    assert list(df["method"]) == [QueryType.API_KRS_ODPIS_PELNY_P.value]


# ─── a failed crawl is not a scrape ───────────────────────


def test_a_zero_byte_failure_marker_is_not_a_scrape():
    """The bug this guards: 1,052 subjects looked done and were never retried."""
    df = answered({odpis("P", "2026-07-18"): 0})

    assert df.empty


def test_a_company_whose_only_crawl_failed_is_not_recorded_as_answered():
    df = answered({odpis("P", "2026-07-18"): 0, odpis("S", "2026-07-18"): 0})

    assert df.empty


def test_a_later_good_crawl_still_counts():
    df = answered({odpis("P", "2026-07-18"): 0, odpis("P", "2026-07-19"): 4096})

    assert list(df["date"]) == ["2026-07-19"]
    assert "empty" not in df.columns


def test_an_empty_current_extract_is_kept_as_the_record_that_it_was_asked():
    """What a company struck off the register gets, run after run - and what
    makes its full extract worth asking for. A full extract that came back
    empty leaves no such record: nothing is owed on the strength of it."""
    full = odpis("S", "2026-09-28").replace("OdpisAktualny", "OdpisPelny")
    df = scraped({odpis("P", "2026-09-21"): 0, full: 0})

    assert df.to_dict(orient="records") == [
        {
            "krs": KRS,
            "method": QueryType.API_KRS_ODPIS_AKTUALNY_P.value,
            "date": "2026-09-21",
            "not_found": False,
            "empty": True,
        }
    ]
    assert over(df).came_back_empty(None) == {  # type: ignore[arg-type]
        KRS: {QueryType.API_KRS_ODPIS_AKTUALNY_P}
    }


def test_a_reference_whose_size_is_unknown_is_kept():
    """Unknown is not empty - only a listing that carries sizes can say."""
    df = scraped({odpis("P", "2026-07-18"): None})

    assert len(df) == 1


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


def missing_register_entries(blobs) -> set[str]:
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
