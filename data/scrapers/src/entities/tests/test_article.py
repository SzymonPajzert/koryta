"""Tests for the Article and Mention data classes."""

import unittest
from src.entities.article import Article, Mention


class TestArticle(unittest.TestCase):
    """Test cases for the Article and Mention data classes."""

    def test_article_creation(self):
        """Tests creation of an Article object."""
        article = Article(
            id="123",
            title="Test Article",
            url="http://example.com/article",
            mentioned_person="John Doe",
        )
        self.assertEqual(article.id, "123")
        self.assertEqual(article.title, "Test Article")
        self.assertEqual(article.url, "http://example.com/article")
        self.assertEqual(article.mentioned_person, "John Doe")

    def test_mention_creation(self):
        """Tests creation of a Mention object."""
        mention = Mention(text="some keyword", url="http://example.com/source")
        self.assertEqual(mention.text, "some keyword")
        self.assertEqual(mention.url, "http://example.com/source")


if __name__ == "__main__":
    unittest.main()
