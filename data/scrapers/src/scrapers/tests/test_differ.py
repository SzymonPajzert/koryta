import argparse
import io
import unittest
from unittest.mock import MagicMock, Mock, patch

import pandas as pd

from scrapers.koryta.differ import KorytaDiffer
from scrapers.stores import Context


class TestKorytaDiffer(unittest.TestCase):
    def setUp(self):
        self.mock_ctx = Mock(spec=Context)
        self.mock_ctx.io = Mock()
        self.mock_ctx.refresh_policy = MagicMock()
        self.mock_ctx.refresh_policy.should_refresh.return_value = False
        self.mock_ctx.refresh_policy.refreshed_pipelines = set()

        # Flags mock
        self.flags_mock = argparse.Namespace(diff_week=False, diff_date=None)

    def test_process_no_data(self):
        """Should exit gracefully if no data found for a type."""
        pipeline = KorytaDiffer()

        with patch.object(KorytaDiffer, "flags", self.flags_mock):
            with patch("scrapers.koryta.differ.FirestoreCollection") as mock_fc:
                mock_pipe = mock_fc.return_value
                mock_pipe.read_or_process.return_value = pd.DataFrame()

                with patch("sys.stdout", new_callable=io.StringIO) as mock_stdout:
                    pipeline.process(self.mock_ctx)
                    output = mock_stdout.getvalue()

                self.assertIn("No data found.", output)

    def test_compare_dates_logic(self):
        """Verify compare_dates identifies new/deleted correctly."""
        pipeline = KorytaDiffer()
        pipeline.id_map = {}

        df = pd.DataFrame(
            [
                {"id": "A", "name": "Alice", "date": "2024-01-01"},
                {"id": "B", "name": "Bob", "date": "2024-01-02"},
            ]
        )

        with patch("sys.stdout", new_callable=io.StringIO) as mock_stdout:
            pipeline.compare_dates(df, "2024-01-01", "2024-01-02", ["name"])
            output = mock_stdout.getvalue()

        self.assertIn("Comparing 2024-01-01 -> 2024-01-02", output)
        self.assertIn("New: 1, Deleted: 1", output)

    def test_id_map_population(self):
        """Verify id_map is populated during process_type for nodes."""
        pipeline = KorytaDiffer()
        pipeline.id_map = {}

        df = pd.DataFrame(
            [
                {"id": "1", "name": "Alice", "date": "2024-01-01"},
                {"id": "2", "name": "Bob", "date": "2024-01-02"},
            ]
        )

        with patch("scrapers.koryta.differ.FirestoreCollection") as mock_fc:
            mock_pipe = mock_fc.return_value
            mock_pipe.read_or_process.return_value = df

            pipeline.process_type(self.mock_ctx, "nodes", "person", ["name"])

            self.assertEqual(pipeline.id_map.get("1"), "Alice")
            self.assertEqual(pipeline.id_map.get("2"), "Bob")

    def test_print_stats_unexpected_fields(self):
        """Verify unexpected fields are reported."""
        pipeline = KorytaDiffer()
        df = pd.DataFrame(
            [
                {"id": "1", "date": "2024-01-01", "name": "A", "SURPRISE": "VAL"},
            ]
        )

        with patch("sys.stdout", new_callable=io.StringIO) as mock_stdout:
            pipeline.print_stats(df, "2024-01-01", ["name"])
            output = mock_stdout.getvalue()

        self.assertIn("Unexpected Fields:", output)
        self.assertIn("SURPRISE", output)


if __name__ == "__main__":
    unittest.main()
