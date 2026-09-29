"""Asking api-krs about one KRS number."""

import time
from collections.abc import Callable
from datetime import datetime

import requests

from scrapers.krs.register import (
    STATUS_FAILED,
    STATUS_NOT_FOUND,
    STATUS_OK,
    STATUS_STRUCK_OFF,
    RegisterRead,
)

ODPIS_URL = "https://api-krs.ms.gov.pl/api/krs/OdpisAktualny/{krs}?rejestr={rejestr}&format=json"

#: The two registers, in the order they are asked. A company is in P, and so is
#: most of what the bulletin names; S is associations, foundations and SPZOZ.
REGISTERS = ("P", "S")

#: Tries per register before a number is logged as a failure, and the timeout
#: of each. api-krs answered 25k reads at ~0.2 s with no throttling; the 15 that
#: failed did so together, in one 95 s stall.
ATTEMPTS = 3
TIMEOUT_SECONDS = 30


def ask(
    session: requests.Session,
    krs: str,
    interval: float,
    now: Callable[[], datetime],
    run: str | None = None,
) -> RegisterRead:
    """Ask both registers about one KRS number, P first.

    A 404 moves on to the other register; a 204 is an answer - the entry is
    there and has no current extract - and so is an odpis. Anything else is
    retried a few times and then logged as a failure, which the queue puts
    first on the next run.
    """

    def read(status: str, rejestr=None, body=None, error=None) -> RegisterRead:
        return RegisterRead(
            krs=krs,
            read_at=now().isoformat(timespec="seconds"),
            status=status,
            rejestr=rejestr,
            body=body,
            error=error,
            run=run,
        )

    for rejestr in REGISTERS:
        response = None
        error = None
        for attempt in range(ATTEMPTS):
            try:
                response = session.get(
                    ODPIS_URL.format(krs=krs, rejestr=rejestr), timeout=TIMEOUT_SECONDS
                )
            except requests.RequestException as e:
                response = None
                error = str(e)
            if response is not None and response.status_code in (200, 204, 404):
                break
            if response is not None:
                error = f"HTTP {response.status_code}"
            time.sleep(5 * (attempt + 1))
        if response is None or response.status_code not in (200, 204, 404):
            return read(STATUS_FAILED, rejestr, error=error)
        if response.status_code == 204:
            return read(STATUS_STRUCK_OFF, rejestr)
        if response.status_code == 200:
            try:
                data = response.json()
            except ValueError as e:
                return read(STATUS_FAILED, rejestr, error=f"not JSON: {e}")
            if "odpis" in data:
                return read(STATUS_OK, rejestr, body=data)
        # A 404, or a 200 whose body says "Not Found": try the other register.
        time.sleep(interval)
    return read(STATUS_NOT_FOUND)
