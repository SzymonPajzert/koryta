"""Utility data classes and functions for data processing."""

from dataclasses import dataclass
from urllib.parse import parse_qsl, urlencode, urlparse


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
    query: dict[str, str]
    full_url: str

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

        if parsed.query:
            query = {}
            for pair in parsed.query.split("&"):
                key, value = pair.split("=")
                query[key] = value
        else:
            query = {}

        return NormalizedParse(
            scheme=parsed.scheme,
            netloc=parsed.netloc,
            path=parsed.path,
            hostname=hostname,
            hostname_normalized=hostname_normalized,
            domain=domain,
            query=query,
            full_url=parsed.geturl(),
        )


def parse_query(query: str) -> list[tuple[str, str]]:
    """Decoded key/value pairs from a query string, blanks and order kept."""
    return parse_qsl(query, keep_blank_values=True)


def format_query(pairs: list[tuple[str, str]]) -> str:
    """Encode key/value pairs back into a query string."""
    return urlencode(pairs)
