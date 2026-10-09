"""That a NIP search's answer is named, and found again, as the bucket holds them."""

from scrapers.krs import nip_answers
from scrapers.stores.file import DownloadableFile

BUCKET = "gs://koryta-pl-crawled/"


def test_a_new_answer_is_named_as_the_stored_ones_are():
    """The CRU crawl filed its answers under this name; the local cache flattens
    it to the one below. A different name would ask every NIP again."""
    name = nip_answers.blob_name("1010000019", "2026-09-14")
    assert name.replace("/", ".") == (
        "hostname=wyszukiwarka-krs-api.ms.gov.pl.api.wyszukiwarka.krs.nip"
        ".1010000019.date=2026-09-14"
    )


def test_a_listed_answer_reads_back_by_its_last_stamp():
    name = nip_answers.blob_name("1010000019", "2026-09-14")
    assert nip_answers.parse_listed(BUCKET + name) == nip_answers.StoredAnswer(
        nip="1010000019", day="2026-09-14", blob=name
    )
    doubled = nip_answers.parse_listed(BUCKET + name + "/date=2026-09-14")
    assert doubled is not None and doubled.day == "2026-09-14"


def test_what_is_not_an_answer_is_not_read_as_one():
    odpis = (
        BUCKET + "hostname=wyszukiwarka-krs-api.ms.gov.pl/api/wyszukiwarka/"
        "OdpisPelny/pdf/S/0000822302/date=2026-09-14"
    )
    short = BUCKET + nip_answers.blob_name("101000001", "2026-09-14")
    undated = BUCKET + nip_answers.blob_name("1010000019", "").split("/date=")[0]
    assert [nip_answers.parse_listed(u) for u in (odpis, short, undated)] == [None] * 3


class Listing:
    def __init__(self, names):
        self.names = names

    def list_files(self, ref):
        assert ref.prefix.endswith("/api/wyszukiwarka/krs/nip/")
        for name in self.names:
            yield DownloadableFile(BUCKET + name, size=10)


class Ctx:
    def __init__(self, names):
        self.io = Listing(names)


def test_the_newest_answer_per_nip_stands():
    names = [
        nip_answers.blob_name("1010000019", "2026-09-27"),
        nip_answers.blob_name("1010000019", "2026-09-14"),
        nip_answers.blob_name("7743261776", "2026-09-23"),
    ]
    stored = nip_answers.stored_answers(Ctx(names))
    assert {nip: s.day for nip, s in stored.items()} == {
        "1010000019": "2026-09-27",
        "7743261776": "2026-09-23",
    }
    assert stored["1010000019"].ref is not None


def test_no_hits_is_an_answer_and_a_broken_body_is_not():
    hit = {"krs": "0000183608", "name": "HUCK POLSKA", "register": "P"}
    assert nip_answers.hits_of('{"nip": "1010000019", "hits": []}') == []
    assert nip_answers.hits_of(
        '{"nip": "1010000019", "hits": [{"krs": "0000183608", "name": "HUCK '
        'POLSKA", "register": "P"}, {"krs": ""}]}'
    ) == [hit]
    assert [nip_answers.hits_of(b) for b in ("", "{", "[]", '{"nip": "1"}')] == [
        None
    ] * 4
