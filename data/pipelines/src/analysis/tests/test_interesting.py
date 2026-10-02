"""What `Companies` writes to companies_merged."""

from analysis.interesting import Companies
from entities.company import Company as KrsCompany


def test_the_merge_writes_the_companies_in_the_same_order_every_run():
    """Two runs on the same data write the same file, so a diff shows a change.

    The KRS numbers are gathered in a set, which iterates differently every run.
    """

    class FakeKrs:
        def read_or_process_list(self, ctx):
            return [
                KrsCompany(krs=krs)
                for krs in ["0000300000", "0000100000", "0000200000"]
            ]

    class FakeEmpty:
        def read_or_process_list(self, ctx):
            return []

    class FakeTeryt:
        cities_to_teryt: dict[str, str] = {}

        def read_or_process(self, ctx):
            return None

    pipeline = Companies()
    pipeline.scraped_companies = FakeKrs()  # type: ignore[assignment]
    pipeline.hardcoded_companies = FakeEmpty()  # type: ignore[assignment]
    pipeline.teryt_pipeline = FakeTeryt()  # type: ignore[assignment]

    df = pipeline.process(None)  # type: ignore[arg-type]

    assert df["krs"].tolist() == ["0000100000", "0000200000", "0000300000"]
