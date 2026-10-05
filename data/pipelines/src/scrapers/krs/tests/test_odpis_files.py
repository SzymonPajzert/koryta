"""That a stored odpis is named, and found again, as the bucket already holds them."""

import pytest

from entities.util import NormalizedParse
from scrapers.krs import odpis_files
from scrapers.stores.file import DownloadableFile


def uploaded_name(url: str, day: str) -> str:
    """The blob name `stores.storage.Client.upload` gives a URL, as it builds it."""
    source = NormalizedParse.parse(url)
    return f"hostname={source.hostname}/{source.path}/date={day}".replace("//", "/")


def test_a_new_odpis_is_named_as_every_stored_one_was():
    """The 8,300 odpisy crawled before the job went through `Client.upload`.

    A different name would file new ones where neither the job's skip nor the
    pipelines look -- permanently, since the crawl account cannot delete.
    """
    url = f"https://{odpis_files.HOST}" + odpis_files.odpis_path("822302", "S")
    name = odpis_files.blob_name("822302", "S", "2026-09-14")
    assert name == uploaded_name(url, "2026-09-14")
    assert name == (
        "hostname=wyszukiwarka-krs-api.ms.gov.pl/api/wyszukiwarka/OdpisPelny"
        "/pdf/S/0000822302/date=2026-09-14"
    )


def test_an_aktualny_is_not_filed_under_the_pelny():
    assert "/OdpisAktualny/pdf/P/" in odpis_files.blob_name(
        "1", "P", "2026-10-02", full=False
    )


@pytest.mark.parametrize("register", ["", "X", "p"])
def test_only_the_two_registers_name_a_blob(register):
    with pytest.raises(ValueError):
        odpis_files.blob_name("1", register, "2026-10-02")


def test_pad_krs_keeps_significant_leading_zeros():
    assert odpis_files.pad_krs("4") == "0000000004"
    assert odpis_files.pad_krs(" 0000000004 ") == "0000000004"
    for bad in ("", "abc", "12345678901"):
        with pytest.raises(ValueError):
            odpis_files.pad_krs(bad)


def listed(name: str) -> str:
    return f"gs://koryta-pl-crawled/{name}"


def test_a_listed_odpis_reads_back_as_what_it_is():
    name = odpis_files.blob_name("29", "P", "2026-09-18")
    stored = odpis_files.parse_listed(listed(name))
    assert stored == odpis_files.StoredOdpis(
        krs="0000000029", register="P", day="2026-09-18", blob=name
    )


def test_a_nip_search_answer_under_the_same_host_is_not_an_odpis():
    answer = (
        "hostname=wyszukiwarka-krs-api.ms.gov.pl/api/wyszukiwarka/krs/nip"
        "/5250001090/date=2026-09-14"
    )
    assert odpis_files.parse_listed(listed(answer)) is None


def test_a_doubled_stamp_reads_by_its_last_date():
    name = odpis_files.blob_name("29", "S", "2026-09-14") + "/date=2026-09-14"
    stored = odpis_files.parse_listed(listed(name))
    assert stored is not None and stored.day == "2026-09-14"


class FakeIO:
    def __init__(self, names):
        self.names = names
        self.listed = []

    def list_files(self, ref):
        self.listed.append(ref.prefix)
        for name in self.names:
            yield DownloadableFile(listed(name))


class FakeContext:
    def __init__(self, names):
        self.io = FakeIO(names)


def test_the_newest_odpis_of_each_company_wins_from_one_listing():
    ctx = FakeContext(
        [
            odpis_files.blob_name("29", "P", "2026-09-14"),
            odpis_files.blob_name("29", "P", "2026-09-30"),
            odpis_files.blob_name("31", "S", "2026-09-15"),
            odpis_files.blob_name("31", "S", "2026-09-15", full=False),
        ]
    )
    stored = odpis_files.stored_odpisy(ctx)
    assert {k: (v.register, v.day) for k, v in stored.items()} == {
        "0000000029": ("P", "2026-09-30"),
        "0000000031": ("S", "2026-09-15"),
    }
    assert stored["0000000029"].ref is not None
    assert ctx.io.listed == [odpis_files.PREFIX]
