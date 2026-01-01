import argparse
import copy
import io
import unittest
from unittest.mock import MagicMock, Mock, patch

from scrapers.koryta.differ import KorytaDiffer
from scrapers.stores import Context, DownloadableFile, Utils, Web


class TestKorytaDifferE2E(unittest.TestCase):
    def setUp(self):
        self.mock_io = Mock()
        self.mock_io.list_namespaces.return_value = ["2024-01-01", "2024-01-02"]
        self.mock_io.refresh_policy = MagicMock()
        self.mock_io.refresh_policy.should_refresh.return_value = True
        self.mock_io.refresh_policy.refreshed_pipelines = set()

        self.urls = [
            "gs://bucket/hostname=koryta.pl/date=2024-01-01/nodes_person_output.jsonl",
            "gs://bucket/hostname=koryta.pl/date=2024-01-02/nodes_person_output.jsonl",
        ]
        self.mock_io.list_files.return_value = [
            DownloadableFile(url=u) for u in self.urls
        ]

        def read_data_side_effect(ref):
            m = Mock()
            url_bytes = ref.url.encode()
            m.read_file.return_value = io.BytesIO(url_bytes)
            return m

        self.mock_io.read_data.side_effect = read_data_side_effect

        self.ctx = Context(
            io=self.mock_io,
            rejestr_io=None,
            con=Mock(),
            utils=Mock(spec=Utils),
            web=Mock(spec=Web),
            refresh_policy=self.mock_io.refresh_policy,
        )

        # Mock parsing to return some data to find differences
        # Must include _key as download.py deletes it
        self.data_by_url = {
            self.urls[0]: [
                {"type": "person", "id": "A", "name": "Al", "_key": {"name": "A"}}
            ],
            self.urls[1]: [
                {"type": "person", "id": "B", "name": "Bo", "_key": {"name": "B"}}
            ],
        }

    def test_e2e_default_run(self):
        """Simulate a run without flags (Latest vs Previous)."""
        pipeline = KorytaDiffer()
        flags = argparse.Namespace(diff_week=False, diff_date=None)

        def parse_side_effect(content_io):
            content = content_io.read()
            url = content.decode()
            # Return a COPY because download.py modifies it (deletes _key)
            data = self.data_by_url.get(url, [])
            return copy.deepcopy(data)

        with patch.object(KorytaDiffer, "flags", flags):
            with patch(
                "scrapers.koryta.download.parse_leveldb_documents",
                side_effect=parse_side_effect,
            ):
                capture = io.StringIO()
                with patch("sys.stdout", capture):
                    pipeline.process(self.ctx)
                    output = capture.getvalue()

        # Check if we see the expected comparison
        if "Comparing 2024-01-01 -> 2024-01-02" not in output:
            print(f"DEBUG OUTPUT:\n{output}")
            
        self.assertIn("Comparing 2024-01-01 -> 2024-01-02", output)
        self.assertIn("New: 1, Deleted: 1", output)
        self.assertIn("Name: Bo", output)


if __name__ == "__main__":
    unittest.main()
