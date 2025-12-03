import sys
import select
from urllib.parse import urljoin
from scrapers.stores import Utils

class UtilsImpl(Utils):
    def input_with_timeout(self, msg: str, timeout: int = 10) -> str | None:
        print(msg)
        sys.stdout.flush()
        i, o, e = select.select([sys.stdin], [], [], timeout)

        if i:
            return sys.stdin.readline().strip()
        else:
            return None

    def join_url(self, base: str, url: str) -> str:
        return urljoin(base, url)
