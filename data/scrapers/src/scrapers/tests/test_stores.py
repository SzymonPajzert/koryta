"""Tests for the abstract store interfaces and data structures."""

import unittest

from scrapers.stores import (
    CloudStorage,
    DownloadableFile,
    FirestoreCollection,
    LocalFile,
)


class TestStores(unittest.TestCase):
    """Test cases for the stores module."""

    def test_downloadable_file(self):
        """Tests the DownloadableFile dataclass."""
        df = DownloadableFile(url="http://example.com/data.csv")
        self.assertEqual(df.filename, "data.csv")

        df_fallback = DownloadableFile(url="http://example.com/download?id=123", filename_fallback="data.csv")
        self.assertEqual(df_fallback.filename, "data.csv")

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
