"""Tests for the crawler data classes."""

import unittest
from datetime import datetime
from entities.crawler import HostnameConfig, RequestLog, WebsiteIndex


class TestCrawlerEntities(unittest.TestCase):
    """Test cases for crawler-related data classes."""

    def test_hostname_config_creation(self):
        """Tests the creation of a HostnameConfig object."""
        config = HostnameConfig(hostname="example.com", allowed=True, quality="good")
        self.assertEqual(config.hostname, "example.com")
        self.assertTrue(config.allowed)
        self.assertEqual(config.quality, "good")

    def test_request_log_creation(self):
        """Tests the creation of a RequestLog object."""
        now = datetime.now()
        log = RequestLog(
            id="req1",
            website_id="site1",
            domain="example.com",
            url="http://example.com",
            time=now,
            response_code=200,
            payload_size_bytes=1024,
            duration="0.1s",
        )
        self.assertEqual(log.id, "req1")
        self.assertEqual(log.website_id, "site1")
        self.assertEqual(log.domain, "example.com")
        self.assertEqual(log.url, "http://example.com")
        self.assertEqual(log.time, now)
        self.assertEqual(log.response_code, 200)
        self.assertEqual(log.payload_size_bytes, 1024)
        self.assertEqual(log.duration, "0.1s")

    def test_website_index_creation(self):
        """Tests the creation of a WebsiteIndex object."""
        index = WebsiteIndex(id="idx1", url="http://example.com/page", interesting=True)
        self.assertEqual(index.id, "idx1")
        self.assertEqual(index.url, "http://example.com/page")
        self.assertTrue(index.interesting)

        index_none = WebsiteIndex(
            id="idx2", url="http://example.com/other", interesting=None
        )
        self.assertIsNone(index_none.interesting)


if __name__ == "__main__":
    unittest.main()
