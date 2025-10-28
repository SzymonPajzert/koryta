import copy

from urllib.parse import urlparse, ParseResult


class NormalizedParse:
    def __init__(self, arg: ParseResult, url):
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
        self.url = url

    hostname_normalized: str
    domain: str

    @staticmethod
    def parse(url):
        if url.endswith("/"):
            url = url[:-1]
        return NormalizedParse(urlparse(url), url)

    def extend(self, suffix) -> "NormalizedParse":
        copy_parsed = copy.deepcopy(self)
        copy_parsed.path += f"/{suffix}"
        return copy_parsed
