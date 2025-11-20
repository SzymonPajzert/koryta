"""Tests for the abstract store interfaces and data structures."""

import unittest
from unittest.mock import MagicMock, patch
from io import StringIO, BytesIO
import typing

from src.scrapers.stores import (
    File,
    IO,
    RejestrIO,
    Context,
    DataRef,
    DownloadableFile,
    LocalFile,
    FirestoreCollection,
    CloudStorage,
    set_context,
    get_context,
    Pipeline,
)


# Fake/Mock Implementations for testing
class MockFile(File):
    """A mock implementation of the File interface for testing."""

    def __init__(self, content: str | bytes = ""):
        if isinstance(content, str):
            self._content_bytes = content.encode("utf-8")
        else:
            self._content_bytes = content
        self._content_str = self._content_bytes.decode("utf-8")

    def read_iterable(self) -> typing.Iterable:
        return StringIO(self._content_str)

    def read_content(self) -> str | bytes:
        return self._content_bytes

    def read_jsonl(self):
        import json

        return [json.loads(line) for line in self.read_iterable() if line.strip()]

    def read_csv(self, sep=","):
        import csv

        return list(csv.reader(self.read_iterable(), delimiter=sep))

    def read_xls(self, header_rows: int = 0, skip_rows: int = 0):
        # This would require a library like pandas or openpyxl.
        # For a mock, we can return a predefined list of lists.
        print(f"Mock-reading XLS with header={header_rows}, skip={skip_rows}")
        return [["mock", "data"], ["row1", "row2"]]

    def read_parquet(self):
        raise NotImplementedError("MockFile does not implement read_parquet.")

    def read_zip(self, inner_path: str | None = None, idx: int | None = None) -> "File":
        # Returns a mock file representing the content of the zip.
        return MockFile(f"zipped content: {inner_path or idx}")

    def read_file(self) -> typing.BinaryIO | typing.TextIO:
        return BytesIO(self._content_bytes)


class MockIO(IO):
    """A mock implementation of the IO interface for testing."""

    def __init__(self):
        self.files: dict[str, File] = {}
        self.output: list[typing.Any] = []
        self.listed_data: dict[str, list[str]] = {}

    def read_data(self, fs: DataRef, process_if_missing=True) -> File:
        key = str(fs)
        if key not in self.files:
            if process_if_missing:
                # In a real scenario, this might trigger a pipeline
                print(f"MockIO: Data for {key} not found, returning empty MockFile.")
                return MockFile()
            raise FileNotFoundError(f"No mock data for {key}")
        return self.files[key]

    def list_data(self, path: DataRef) -> list[str]:
        key = str(path)
        return self.listed_data.get(key, [])

    def output_entity(self, entity):
        self.output.append(entity)


class MockRejestrIO(RejestrIO):
    """A mock implementation of the RejestrIO interface for testing."""

    def __init__(self):
        self.responses: dict[str, str] = {}

    def get_rejestr_io(self, url: str) -> str | None:
        return self.responses.get(url)


class TestStores(unittest.TestCase):
    """Test cases for the stores module."""

    def test_downloadable_file(self):
        """Tests the DownloadableFile dataclass."""
        df = DownloadableFile(url="http://example.com/data.csv")
        self.assertEqual(df.filename, "data.csv")

        df_fallback = DownloadableFile(
            url="http://example.com/download?id=123", filename_fallback="data.csv"
        )
        self.assertEqual(df_fallback.filename, "data.csv")

    def test_context_management(self):
        """Tests the set_context and get_context functions."""
        mock_io = MockIO()
        mock_rejestr_io = MockRejestrIO()
        ctx = Context(io=mock_io, rejestr_io=mock_rejestr_io)
        
        set_context(ctx)
        retrieved_ctx = get_context()
        
        self.assertIs(ctx, retrieved_ctx)
        self.assertIs(ctx.io, mock_io)
        self.assertIs(ctx.rejestr_io, mock_rejestr_io)

    def test_get_context_not_set(self):
        """Tests that get_context raises an error if the context is not set."""
        # Reset global context
        with patch("src.scrapers.stores.GLOBAL_CONTEXT", None):
            with self.assertRaises(NotImplementedError):
                get_context()

    def test_pipeline_decorator(self):
        """Tests the Pipeline decorator."""
        pipeline = Pipeline(use_rejestr_io=True)

        @pipeline
        def my_test_pipeline(ctx: Context):
            """A dummy pipeline function."""
            return f"Processed with {ctx}"

        # The decorator should store the function
        self.assertTrue(callable(pipeline.process))
        self.assertEqual(pipeline.process.__name__, "my_test_pipeline")
        self.assertTrue(pipeline.rejestr_io)

    def test_dataref_classes(self):
        """Tests the simple DataRef dataclasses."""
        local = LocalFile("file.txt")
        self.assertEqual(local.filename, "file.txt")

        firestore = FirestoreCollection("users", filters=[("age", ">", 18)])
        self.assertEqual(firestore.collection, "users")
        self.assertEqual(firestore.filters, [("age", ">", 18)])

        gcs = CloudStorage("my-bucket")
        self.assertEqual(gcs.hostname, "my-bucket")


if __name__ == "__main__":
    unittest.main()
