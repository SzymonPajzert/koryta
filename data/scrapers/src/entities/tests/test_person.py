"""Tests for the person data classes."""

import unittest
from entities.person import Koryta, KRS, PKW, Wikipedia


class TestPersonEntities(unittest.TestCase):
    """Test cases for person-related data classes."""

    def test_koryta_creation(self):
        """Tests creation of a Koryta person object."""
        person = Koryta(id="p1", full_name="Jan Kowalski", party="ABC")
        self.assertEqual(person.id, "p1")
        self.assertEqual(person.full_name, "Jan Kowalski")
        self.assertEqual(person.party, "ABC")

    def test_krs_creation(self):
        """Tests creation of a KRS person object."""
        person = KRS(
            id="0000000123",
            first_name="Anna",
            last_name="Nowak",
            full_name="Anna Nowak",
            employed_krs="0000123456",
            employed_start="2022-01-01",
            employed_end=None,
            employed_for="1.5",
            birth_date="1990-05-15",
            sex="F",
        )
        self.assertEqual(person.id, "0000000123")
        self.assertEqual(person.first_name, "Anna")
        self.assertEqual(person.last_name, "Nowak")
        self.assertEqual(person.full_name, "Anna Nowak")
        self.assertEqual(person.employed_krs, "0000123456")
        self.assertEqual(person.employed_start, "2022-01-01")
        self.assertIsNone(person.employed_end)
        self.assertEqual(person.employed_for, "1.5")
        self.assertEqual(person.birth_date, "1990-05-15")
        self.assertEqual(person.sex, "F")

    def test_pkw_creation(self):
        """Tests creation of a PKW person object."""
        person = PKW(
            election_year="2023",
            election_type="sejm",
            first_name="Piotr",
            last_name="Zieliński",
            party="XYZ",
        )
        self.assertEqual(person.election_year, "2023")
        self.assertEqual(person.election_type, "sejm")
        self.assertEqual(person.first_name, "Piotr")
        self.assertEqual(person.last_name, "Zieliński")
        self.assertEqual(person.party, "XYZ")

    def test_wikipedia_creation(self):
        """Tests creation of a Wikipedia person object."""
        person = Wikipedia(
            source="http://pl.wikipedia.org/wiki/Adam_Mickiewicz",
            full_name="Adam Mickiewicz",
            party="",
            birth_iso8601="1798-12-24",
            birth_year=1798,
            infobox="polski poeta",
            content_score=10,
            links=["link1", "link2"],
        )
        self.assertEqual(person.full_name, "Adam Mickiewicz")
        self.assertEqual(person.birth_year, 1798)
        self.assertEqual(person.content_score, 10)
        self.assertEqual(person.links, ["link1", "link2"])


if __name__ == "__main__":
    unittest.main()
