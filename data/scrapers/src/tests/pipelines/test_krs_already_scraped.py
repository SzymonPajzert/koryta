import pytest

from koryta import setup_context
from pipelines import KRSAlreadyScraped


@pytest.fixture(scope="module")
def ctx():
    return setup_context(False)[0]


@pytest.mark.skip(reason="TODO it fails for KRS that are already closed")
def test_both_aktualnosc_are_scraped(ctx):
    df = KRSAlreadyScraped().read_or_process(ctx)
    per_method = df[["krs", "method"]].groupby("krs").aggregate(lambda d: d.unique())
    print(per_method.head())
    print(per_method.loc["0000000449"])

    only_one_aktualnosc = per_method["method"].apply(
        lambda methods: (
            ("aktualnosc_aktualne" in methods) ^ ("aktualnosc_historyczne" in methods)
        )
    )
    only_one_aktualnosc = per_method[only_one_aktualnosc]
    print(only_one_aktualnosc.head())

    assert len(only_one_aktualnosc) == 0, (
        f"found {len(only_one_aktualnosc)} companies with only one aktualnosc method: \
head: \
{only_one_aktualnosc.head()}"
    )
