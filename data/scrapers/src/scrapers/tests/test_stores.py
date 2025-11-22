"""Tests for the abstract store interfaces and data structures."""

import unittest
from unittest.mock import patch
from scrapers.tests.mocks import MockIO, MockRejestrIO

from scrapers.stores import (
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
        ctx = Context(io=mock_io, rejestr_io=mock_rejestr_io, con=None)

        set_context(ctx)
        retrieved_ctx = get_context()

        self.assertIs(ctx, retrieved_ctx)
        self.assertIs(ctx.io, mock_io)
        self.assertIs(ctx.rejestr_io, mock_rejestr_io)

    def test_pipeline_decorator(self):
        """Tests the Pipeline decorator."""
        pipeline = Pipeline.setup(use_rejestr_io=True)

        @pipeline
        def my_test_pipeline(ctx: Context):
            """A dummy pipeline function."""
            return f"Processed with {ctx}"

        # The decorator should store the function
        self.assertTrue(callable(my_test_pipeline.process))
        self.assertTrue(my_test_pipeline.rejestr_io)

    def test_dataref_classes(self):
        """Tests the simple DataRef dataclasses."""
        local = LocalFile("file.txt", "tests")
        self.assertEqual(local.filename, "file.txt")

        firestore = FirestoreCollection("users", filters=[("age", ">", 18)])
        self.assertEqual(firestore.collection, "users")
        self.assertEqual(firestore.filters, [("age", ">", 18)])

        gcs = CloudStorage("my-bucket")
        self.assertEqual(gcs.hostname, "my-bucket")


if __name__ == "__main__":
    unittest.main()
