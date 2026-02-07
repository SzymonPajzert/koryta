"""Utility data classes and functions for data processing."""

from dataclasses import dataclass
from urllib.parse import urlparse


@dataclass
class IgnoredDates:
    """Represents dates that were ignored during parsing, for later analysis."""

    date: str


@dataclass(frozen=True)
class NormalizedParse:
    """
    A utility class to parse and normalize URLs.

    Provides a standardized representation of a URL, breaking it down into
    its constituent parts and normalizing the hostname.
    """

    scheme: str
    netloc: str
    path: str
    hostname: str
    hostname_normalized: str
    domain: str

    @staticmethod
    def parse(url: str) -> "NormalizedParse":
        """
        Parses a URL string into a NormalizedParse object.

        - Removes trailing slashes.
        - Normalizes the hostname (lowercase, removes 'www.').
        """
        if not isinstance(url, str):
            raise TypeError("URL must be a string.")

        # Handle scheme-less URLs by assuming http
        if not url.startswith(("http://", "https://")):
            url = "http://" + url

        if url.endswith("/"):
            url = url[:-1]

        parsed = urlparse(url)

        hostname = parsed.hostname
        if not hostname:
            hostname = parsed.netloc

        hostname_normalized = hostname.lower()
        if hostname_normalized.startswith("www."):
            hostname_normalized = hostname_normalized[4:]

        domain = f"{parsed.scheme}://{hostname}"

        return NormalizedParse(
            scheme=parsed.scheme,
            netloc=parsed.netloc,
            path=parsed.path,
            hostname=hostname,
            hostname_normalized=hostname_normalized,
            domain=domain,
        )


def parse_hostname(url: str) -> str:
    """Extracts the normalized hostname from a URL."""
    return NormalizedParse.parse(url).hostname_normalized
