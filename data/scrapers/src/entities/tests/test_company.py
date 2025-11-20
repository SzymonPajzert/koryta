"""Tests for the company data classes."""

import unittest
from src.entities.company import KRS, ManualKRS


class TestCompany(unittest.TestCase):
    """Test cases for company-related data classes."""

    def test_krs_creation(self):
        """Tests the creation of a KRS object."""
        krs = KRS(krs="1234567890", name="Test Company", city="Test City")
        self.assertEqual(krs.krs, "1234567890")
        self.assertEqual(krs.name, "Test Company")
        self.assertEqual(krs.city, "Test City")

    def test_manual_krs_creation_and_padding(self):
        """Tests that ManualKRS pads the ID correctly."""
        krs = ManualKRS(id="123")
        self.assertEqual(krs.id, "0000000123")
        krs_int = ManualKRS(id=456)
        self.assertEqual(krs_int.id, "0000000456")

    def test_manual_krs_parse(self):
        """Tests the parse method of ManualKRS."""
        krs = ManualKRS(id="1").parse(123)
        self.assertEqual(krs.id, "0000000123")

    def test_manual_krs_from_blob_name(self):
        """Tests creating a ManualKRS instance from a blob name."""
        blob_name = "rejestr.io/org/1234567890/connections"
        krs = ManualKRS.from_blob_name(blob_name)
        self.assertEqual(krs.id, "1234567890")

    def test_manual_krs_merge_success(self):
        """Tests successful merging of two ManualKRS instances."""
        krs1 = ManualKRS(
            id="123",
            sources={"source1"},
            teryts={"teryt1"},
            ministry="MinistryA",
        )
        krs2 = ManualKRS(
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
        krs1_no_ministry = ManualKRS(id="123", sources={"source1"})
        krs2_with_ministry = ManualKRS(id="123", sources={"source2"}, ministry="MinistryB")
        merged_krs_2 = krs1_no_ministry.merge(krs2_with_ministry)
        self.assertEqual(merged_krs_2.ministry, "MinistryB")


    def test_manual_krs_merge_id_conflict(self):
        """Tests that merging fails with different IDs."""
        krs1 = ManualKRS(id="123")
        krs2 = ManualKRS(id="456")
        with self.assertRaises(ValueError):
            krs1.merge(krs2)

    def test_manual_krs_merge_ministry_conflict(self):
        """Tests that merging fails with conflicting ministries."""
        krs1 = ManualKRS(id="123", ministry="MinistryA")
        krs2 = ManualKRS(id="123", ministry="MinistryB")
        with self.assertRaises(ValueError):
            krs1.merge(krs2)

    def test_manual_krs_equality_and_hash(self):
        """Tests equality and hashing of ManualKRS objects."""
        krs1 = ManualKRS(id="123")
        krs2 = ManualKRS(id=123)
        krs3 = ManualKRS(id="456")
        self.assertEqual(krs1, krs2)
        self.assertNotEqual(krs1, krs3)
        self.assertEqual(hash(krs1), hash(krs2))
        self.assertNotEqual(hash(krs1), hash(krs3))
        self.assertFalse(krs1 == "123")


if __name__ == "__main__":
    unittest.main()
