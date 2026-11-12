"""Tests for the company data classes."""

import unittest

from entities.company import KRS


class TestCompany(unittest.TestCase):
    """Test cases for company-related data classes."""

    def test_manual_krs_creation_and_padding(self):
        """Tests that KRS pads the ID correctly."""
        krs = KRS(id="123")
        self.assertEqual(krs.id, "0000000123")
        krs_int = KRS(id=456)  # type: ignore
        self.assertEqual(krs_int.id, "0000000456")

    def test_manual_krs_parse(self):
        """Tests the parse method of KRS."""
        krs = KRS(id="1").parse(123)
        self.assertEqual(krs.id, "0000000123")

    def test_manual_krs_from_blob_name(self):
        """Tests creating a KRS instance from a blob name."""
        blob_name = "rejestr.io/org/1234567890/connections"
        krs = KRS.from_blob_name(blob_name)
        self.assertEqual(krs.id, "1234567890")

    def test_manual_krs_merge_success(self):
        """Tests successful merging of two KRS instances."""
        krs1 = KRS(
            id="123",
            sources={"source1"},
            teryts={"teryt1"},
            ministry="MinistryA",
        )
        krs2 = KRS(
            id="123",
            sources={"source2"},
            teryts={"teryt2"},
        )
        merged_krs = krs1.merge(krs2)
        self.assertEqual(merged_krs.id, "0000000123")
        self.assertEqual(merged_krs.sources, {"source1", "source2"})
        self.assertEqual(merged_krs.teryts, {"teryt1", "teryt2"})
        self.assertEqual(merged_krs.ministry, "MinistryA")

        # Test merging when first ministry is None
        krs1_no_ministry = KRS(id="123", sources={"source1"})
        krs2_with_ministry = KRS(id="123", sources={"source2"}, ministry="MinistryB")
        merged_krs_2 = krs1_no_ministry.merge(krs2_with_ministry)
        self.assertEqual(merged_krs_2.ministry, "MinistryB")

    def test_manual_krs_merge_id_conflict(self):
        """Tests that merging fails with different IDs."""
        krs1 = KRS(id="123")
        krs2 = KRS(id="456")
        with self.assertRaises(ValueError):
            krs1.merge(krs2)

    def test_manual_krs_merge_ministry_conflict(self):
        """Tests that merging fails with conflicting ministries."""
        krs1 = KRS(id="123", ministry="MinistryA")
        krs2 = KRS(id="123", ministry="MinistryB")
        with self.assertRaises(ValueError):
            krs1.merge(krs2)

    def test_manual_krs_equality_and_hash(self):
        """Tests equality and hashing of KRS objects."""
        krs1 = KRS(id="123")
        krs2 = KRS(id=123)  # type: ignore
        krs3 = KRS(id="456")
        self.assertEqual(krs1, krs2)
        self.assertNotEqual(krs1, krs3)
        self.assertEqual(hash(krs1), hash(krs2))
        self.assertNotEqual(hash(krs1), hash(krs3))
        self.assertFalse(krs1 == "123")


if __name__ == "__main__":
    unittest.main()
