from scrapers.krs.process import KRS


def test_krs_init_with_int():
    krs = KRS(123)
    assert krs.id == "0000000123"


def test_krs_init_with_str():
    krs = KRS("123")
    assert krs.id == "0000000123"


def test_krs_init_with_padded_str():
    krs = KRS("0000000123")
    assert krs.id == "0000000123"


def test_krs_from_blob_name():
    blob_name = "hostname=rejestr.io/date=2025-09-28/api/v2/org/0000002251/krs-powiazania/aktualnosc_aktualne"
    krs = KRS.from_blob_name(blob_name)
    assert krs.id == "0000002251"


def test_krs_str():
    krs = KRS(123)
    assert str(krs) == "0000000123"


def test_krs_repr():
    krs = KRS(123)
    assert repr(krs) == "0000000123"


def test_krs_hash():
    krs1 = KRS(123)
    krs2 = KRS("0000000123")
    assert hash(krs1) == hash(krs2)


def test_krs_eq():
    krs1 = KRS(123)
    krs2 = KRS("0000000123")
    krs3 = KRS(456)
    assert krs1 == krs2
    assert krs1 != krs3
    assert krs1 != "0000000123"
