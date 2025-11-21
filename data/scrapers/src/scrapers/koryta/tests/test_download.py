"""Tests for the koryta.download module."""

import unittest
from unittest.mock import MagicMock, patch

from scrapers.koryta.download import list_people, process_people, process_articles
from scrapers.stores import Context, FirestoreCollection
from entities.person import Koryta as Person
from entities.article import Article


# Mock classes for Firestore documents
class MockFirestoreDocument:
    def __init__(self, doc_id, data):
        self._id = doc_id
        self._data = data

    @property
    def id(self):
        return self._id

    def to_dict(self):
        return self._data


class MockFirestoreIterable:
    def __init__(self, docs_data):
        self._docs = [MockFirestoreDocument(doc_id, data) for doc_id, data in docs_data]

    def read_iterable(self):
        yield from self._docs


class TestKorytaDownload(unittest.TestCase):
    """Test cases for the koryta.download module."""

    def setUp(self):
        """Set up mock context for each test."""
        self.mock_io = MagicMock()
        self.mock_rejestr_io = MagicMock()
        self.ctx = Context(
            io=self.mock_io, rejestr_io=self.mock_rejestr_io, con=MagicMock()
        )

        self.people_data = [
            (
                "person1_id",
                {"name": "Jan Kowalski", "parties": ["PartyA"], "type": "person"},
            ),
            (
                "person2_id",
                {"name": "Anna Nowak", "parties": ["PartyB"], "type": "person"},
            ),
        ]
        self.articles_data = [
            (
                "article1_id",
                {
                    "name": "Article One",
                    "sourceURL": "http://example.com/article1",
                    "type": "article",
                },
            ),
            (
                "article2_id",
                {
                    "name": "Article Two",
                    "sourceURL": "http://example.com/article2",
                    "type": "article",
                },
            ),
        ]
        self.edges_data = [
            (
                "edge1_id",
                {"type": "mentions", "source": "article1_id", "target": "person1_id"},
            ),
            (
                "edge2_id",
                {"type": "mentions", "source": "article1_id", "target": "person2_id"},
            ),
            (
                "edge3_id",
                {"type": "unrelated", "source": "article2_id", "target": "person1_id"},
            ),
        ]

    def test_list_people(self):
        """Tests that list_people correctly extracts Person entities."""
        self.mock_io.read_data.return_value = MockFirestoreIterable(self.people_data)

        people = list(list_people(self.ctx))
        self.assertEqual(len(people), 2)
        self.assertIsInstance(people[0], Person)
        self.assertEqual(people[0].full_name, "Jan Kowalski")
        self.assertEqual(people[0].party, "PartyA")
        self.assertEqual(people[0].id, "person1_id")

    def test_process_people(self):
        """Tests that process_people outputs Person entities."""
        # Mock list_people to return controlled data
        with patch(
            "src.scrapers.koryta.download.list_people",
            return_value=[
                Person("person1_id", "Jan Kowalski", "PartyA"),
                Person("person2_id", "Anna Nowak", "PartyB"),
            ],
        ):
            process_people.process(self.ctx)

        self.assertEqual(len(self.mock_io.output_entities), 2)
        self.assertEqual(self.mock_io.output_entities[0].full_name, "Jan Kowalski")
        self.assertEqual(self.mock_io.output_entities[1].full_name, "Anna Nowak")

    @patch("src.scrapers.koryta.download.list_people")
    def test_process_articles(self, mock_list_people):
        """Tests that process_articles extracts and links articles and mentions."""
        mock_list_people.return_value = [
            Person("person1_id", "Jan Kowalski", "PartyA"),
            Person("person2_id", "Anna Nowak", "PartyB"),
        ]

        # Configure mock_io to return different iterables based on FirestoreCollection
        def mock_read_data_side_effect(fs_collection: FirestoreCollection):
            if (
                fs_collection.collection == "nodes"
                and ("type", "==", "article") in fs_collection.filters
            ):
                return MockFirestoreIterable(self.articles_data)
            if fs_collection.collection == "edges":
                return MockFirestoreIterable(self.edges_data)
            return MagicMock()  # Fallback for other calls

        self.mock_io.read_data.side_effect = mock_read_data_side_effect

        process_articles.process(self.ctx)

        # Check output entities (Articles)
        self.assertEqual(
            len(self.mock_io.output_entities), 2
        )  # article1_id should have 2 mentions, article2_id 0

        # Verify article1_id output
        article1_output = next(
            e for e in self.mock_io.output_entities if e.id == "article1_id"
        )
        self.assertIsInstance(article1_output, Article)
        self.assertEqual(article1_output.title, "Article One")
        self.assertEqual(article1_output.url, "http://example.com/article1")
        self.assertIn(
            article1_output.mentioned_person, ["Jan Kowalski", "Anna Nowak"]
        )  # Order not guaranteed

        # Verify article2_id output (no mentions recorded)
        article2_output = next(
            e for e in self.mock_io.output_entities if e.id == "article2_id"
        )
        self.assertIsInstance(article2_output, Article)
        self.assertEqual(article2_output.title, "Article Two")
        self.assertEqual(article2_output.url, "http://example.com/article2")
        self.assertEqual(
            article2_output.mentioned_person, ""
        )  # No mentions, so should be empty string


if __name__ == "__main__":
    unittest.main()
