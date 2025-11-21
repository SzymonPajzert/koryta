from dataclasses import dataclass
from urllib.parse import urlparse, ParseResult


@dataclass
class IgnoredDates:
    date: str


# TODO make it a nicer class, that contains all the string handling on its own
# Test how we create these paths etc
class NormalizedParse:
    def __init__(self, arg: ParseResult):
        self.scheme = arg.scheme
        self.netloc = arg.netloc
        self.path = arg.path
        self.hostname = arg.hostname
        if not self.hostname:
            self.hostname = arg.netloc
        self.hostname_normalized = self.hostname.lower()
        if self.hostname_normalized.startswith("www."):
            self.hostname_normalized = self.hostname_normalized[4:]
        self.domain = f"{self.scheme}://{self.hostname}"

    hostname_normalized: str
    domain: str

    @staticmethod
    def parse(url):
        if url.endswith("/"):
            url = url[:-1]
        return NormalizedParse(urlparse(url))
