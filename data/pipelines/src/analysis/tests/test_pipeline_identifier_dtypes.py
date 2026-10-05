"""Identifiers have to survive a pipeline's own cache, whichever one serves it.

A pipeline writes jsonl and is read back two different ways, which do not
agree. `FromPath` (the local ``versioned/`` file) turns ``dtype=None`` into
``dtype={}``, and an empty dict tells `pandas.read_json` to convert nothing, so
everything arrives as written. `FromBytesIO` (a restore from the shared GCS
cache) passes ``None`` straight through, so every all-digit column is re-typed
as an integer and its leading zeros are gone.

Which path a run takes depends only on whether ``versioned/`` happened to be on
disk - a laptop mid-session takes the first, a fresh checkout and CI take the
second. So the failure is the worst kind: it never appears where the code was
written, and it is silent when it does, because a TERYT of ``'020102'`` that
became ``20102`` is still a perfectly good-looking value.

Each case below is a real row, and the assertion is that it comes back
unchanged. See `scrapers.krs.columns` for the KRS pipelines, which need more
than a dtype: a column literally named ``date`` is parsed into a Timestamp
whatever ``dtype`` asks for.
"""

import io

import pandas as pd
import pytest

from analysis.people_koryta_merged import PeopleKorytaMerged
from analysis.scores.company import CompanyScores
from analysis.utils.names import NamesCountByRegion
from scrapers.krs.list import CompaniesKRS, PeopleKRS
from scrapers.krs.odpis_people import PeopleKRSCombined
from scrapers.map.postal_codes import PostalCodes
from scrapers.map.teryt import Regions
from scrapers.pkw.process import PeoplePKW
from stores.file import FromBytesIO

#: (pipeline, a real row, the columns that must come back identical).
CASES = [
    pytest.param(
        PostalCodes,
        {"postal_code": "59-700", "city": "rakowice", "teryt": "020102"},
        ["postal_code", "teryt"],
        id="postal-codes-teryt",
    ),
    pytest.param(
        Regions,
        {"id": "0201", "parent_id": "02", "name": "bolesławiecki"},
        ["id", "parent_id"],
        id="regions-teryt",
    ),
    pytest.param(
        CompanyScores,
        {"krs": "0000023545", "sum_score": 1.5},
        ["krs"],
        id="company-scores-krs",
    ),
    pytest.param(
        PeoplePKW,
        {"teryt_candidacy": "020000", "teryt_living": "026401"},
        ["teryt_candidacy", "teryt_living"],
        id="pkw-teryt",
    ),
    pytest.param(
        PeopleKRS,
        {"id": "1403676", "employed_krs": "0000000170", "employed_for": "7.25"},
        ["id", "employed_krs", "employed_for"],
        id="people-krs-ids",
    ),
    pytest.param(
        PeopleKRSCombined,
        {"id": "1403676", "employed_krs": "0000000170", "employed_for": "7.25"},
        ["id", "employed_krs", "employed_for"],
        id="people-krs-combined-ids",
    ),
    pytest.param(
        CompaniesKRS,
        {
            "krs": "0000000111",
            "teryt_code": "3064",
            "nip": "7781387479",
            "regon": "010053589",
        },
        ["krs", "teryt_code", "nip", "regon"],
        id="companies-krs-ids",
    ),
    pytest.param(
        NamesCountByRegion,
        {"last_name": "jankowska", "count": 2079.0, "teryt": "02"},
        ["teryt"],
        id="names-count-teryt",
    ),
    pytest.param(
        PeopleKorytaMerged,
        {
            "first_name": "anna",
            "last_name": "nowak",
            "tail_name": "maria nowak",
            "rejestrio_id": "1403676",
            "koryta_id": "3kQ9xV1bT0mZpL8sWc2R",
            "full_name": "Anna Maria Nowak",
        },
        ["rejestrio_id", "koryta_id"],
        id="people-koryta-merged-ids",
    ),
]


def restored(pipeline, rows) -> pd.DataFrame:
    """The frame as a restore from the shared cache produces it."""
    buffer = io.BytesIO()
    pd.DataFrame(rows).to_json(buffer, orient="records", lines=True)
    buffer.seek(0)
    return FromBytesIO(buffer, pipeline.filename).read_dataframe(
        "jsonl", dtype=pipeline.dtype
    )


@pytest.mark.parametrize("pipeline, row, identifiers", CASES)
def test_an_identifier_survives_a_restore_from_the_shared_cache(
    pipeline, row, identifiers
):
    back = restored(pipeline, [row])

    for column in identifiers:
        assert back.iloc[0][column] == row[column], (
            f"{pipeline.__name__}.{column} came back as "
            f"{back.iloc[0][column]!r} ({back.dtypes[column]}); pin it in "
            f"{pipeline.__name__}.dtype"
        )


@pytest.mark.parametrize("pipeline, row, identifiers", CASES)
def test_the_pin_is_declared_rather_than_relied_on_by_accident(
    pipeline, row, identifiers
):
    """A column that survives only because some other row is non-numeric."""
    declared = pipeline.dtype or {}

    assert set(identifiers) <= set(declared), (
        f"{pipeline.__name__} does not pin {set(identifiers) - set(declared)}"
    )


def test_without_the_pin_the_zeros_really_do_go():
    """The failure this file exists for, shown once."""
    buffer = io.BytesIO()
    pd.DataFrame([{"teryt": "020102"}]).to_json(buffer, orient="records", lines=True)
    buffer.seek(0)

    assert FromBytesIO(buffer, "x").read_dataframe("jsonl").iloc[0]["teryt"] == 20102


def test_a_region_with_no_parent_stays_empty_rather_than_becoming_nan_the_string():
    """`analysis/payloads/region.py:75` guards on the string "nan" for a reason."""
    back = restored(Regions, [{"id": "02", "parent_id": None, "name": "Dolnośląskie"}])

    assert pd.isna(back.iloc[0]["parent_id"])
