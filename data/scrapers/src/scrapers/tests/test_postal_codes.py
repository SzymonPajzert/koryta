import io
from unittest.mock import MagicMock

import pandas as pd

from scrapers.map.postal_codes import PostalCodes
from scrapers.stores import Context


class MockFile:
    def __init__(self, content):
        self.content = content.encode("utf-8")

    def read_file(self):
        return io.BytesIO(self.content)

    def read_dataframe(self, *args, **kwargs):
        return pd.read_csv(io.BytesIO(self.content), sep="\t", header=None)


def test_postal_codes():
    # Sample data mimicking the file structure (tab-separated)
    sample_data = (
        "PL\t59-700\tPlace1\tVoiv1\t02\tPowiat1\t0201\tGmina1\t020102\t51.0\t15.0\t6\n"
        "PL\t59-700\tPlace2\tVoiv1\t02\tPowiat1\t0201\tGmina2\t020103\t51.1\t15.1\t6\n"
        "PL\t00-001\tPlace3\tVoiv2\t14\tPowiat2\t1465\tGmina2\t146501\t52.0\t21.0\t6\n"
        "PL\t11-111\tPlace4\tVoiv3\t20\tPowiat3\t2001\tGmina3\t200101\t53.0\t22.0\t6\n"
        "PL\t11-111\tPlace5\tVoiv3\t20\tPowiat3\t2001\tGmina3\t200101\t53.1\t22.1\t6\n"
    )

    mock_ctx = MagicMock(spec=Context)
    mock_ctx.io = MagicMock()
    mock_ctx.io.read_data.return_value = MockFile(sample_data)

    pipeline = PostalCodes()
    result = pipeline.process(mock_ctx)

    # Assertions
    # 59-700: 020102 and 020103
    row_59_700 = result[result["postal_code"] == "59-700"].iloc[0]
    assert row_59_700["teryt"] in ["020102", "020103"]

    # 00-001: 146501
    row_00_001 = result[result["postal_code"] == "00-001"].iloc[0]
    assert row_00_001["teryt"] == "146501"

    # 11-111: 200101 and 200101
    row_11_111 = result[result["postal_code"] == "11-111"].iloc[0]
    assert row_11_111["teryt"] == "200101"
