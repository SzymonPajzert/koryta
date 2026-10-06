import os
import sys

import requests
from dotenv import load_dotenv

#: Seconds rejestr.io gets to answer one request. Without a limit a connection
#: that never answers holds a run - an unattended one until it is killed.
REQUEST_TIMEOUT = 30


def read_key() -> str | None:
    """The rejestr.io key: REJESTR_KEY, from the environment or `.env`."""
    load_dotenv()
    return os.getenv("REJESTR_KEY") or None


class Rejestr:
    """rejestr.io by hand: asks whether to ask, query by query, unless told not to."""

    def __init__(self):
        self.REJESTR_KEY = read_key()
        # Never the key itself: whatever is printed ends up in a log somewhere.
        if not self.REJESTR_KEY:
            print(
                "No rejestr.io key: go to https://rejestr.io/konto/api and set "
                "REJESTR_KEY in .env"
            )
            sys.exit(1)
        print("rejestr.io key: REJESTR_KEY is set")

        self.ALWAYS_ALLOW = False
        print("Should I always ask before querying rejestr.io? [Yn]")
        if input() == "n":
            print("I will always allow")
            self.ALWAYS_ALLOW = True
        else:
            print("I will always ask for permission")

    def get_rejestr_io(self, url: str):
        allowed = self.ALWAYS_ALLOW
        print(f"Querying {url}")
        if not self.ALWAYS_ALLOW:
            print("Should I query? [yN]")
            allowed = input() == "y"
        if not allowed:
            print("Not allowed")
            return {}

        assert self.REJESTR_KEY is not None
        response = requests.get(
            url, headers={"Authorization": self.REJESTR_KEY}, timeout=REQUEST_TIMEOUT
        )
        if response.status_code != 200:
            print(response.status_code)
            return None
        return response.text


class RejestrRefused(RuntimeError):
    """rejestr.io refuses the account, not the question: a key it does not
    take, no credit left, too many requests. Every call after would be refused
    the same way, so a run stops here."""

    def __init__(self, status: int, body: str = ""):
        super().__init__(f"rejestr.io refused: HTTP {status} {body[:200]}".strip())
        self.status = status


class RejestrUnavailable(RuntimeError):
    """rejestr.io failed to answer this one (5xx); the next may go through."""

    def __init__(self, status: int):
        super().__init__(f"rejestr.io did not answer: HTTP {status}")
        self.status = status


class UnattendedRejestr:
    """rejestr.io with nobody at the keyboard: never asks, never prints the key.

    What a run that answers to a cap rather than to a person uses. Whether to
    buy was decided before the first call; here every answer is one of three:
    the body (200, bought), None (404: rejestr.io has nothing under it), or an
    exception - `RejestrRefused` for any other 4xx, which ends the run, and
    `RejestrUnavailable` or a network error, which costs this call only.
    """

    def __init__(
        self,
        key: str | None = None,
        session: requests.Session | None = None,
        timeout: float = REQUEST_TIMEOUT,
    ):
        key = key or read_key()
        if not key:
            raise RuntimeError(
                "No rejestr.io key: set REJESTR_KEY (https://rejestr.io/konto/api)"
            )
        self._key = key
        self._session = session or requests.Session()
        self._timeout = timeout

    def get_rejestr_io(self, url: str) -> str | None:
        response = self._session.get(
            url, headers={"Authorization": self._key}, timeout=self._timeout
        )
        status = response.status_code
        if status == 200:
            return response.text
        if status == 404:
            return None
        if 400 <= status < 500:
            raise RejestrRefused(status, response.text or "")
        raise RejestrUnavailable(status)
