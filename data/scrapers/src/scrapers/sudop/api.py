"""Client for the UOKiK SUDOP API.

SUDOP (System Udostępniania Danych o Pomocy Publicznej) is the register every
grant of state aid in Poland has to be reported to. Its API is public and needs
no key - `x-auth-type: None` on every operation in
https://api-sudop.uokik.gov.pl/swagger/sudop-api.yml - but it does not answer a
search directly. A search returns 303 to a queue, the queue answers 200 with a
sentence about how long it expects to take, and only once it is done does it
303 on to the result. A whole aid measure comes back as one document: 9350 rows
for SA.116730, in a little over four minutes.

Redirects are never followed, because both 303s carry the only copy of
something this module needs - which queue to poll, and then which result to
fetch. The gateway in front of the API also rate-limits, with a bare nginx 429
rather than anything from the API, so every request backs off and retries.
Nothing in the flow is unsafe to repeat: re-submitting a search queues a second
one and nothing else.
"""

import time
import typing

import requests

HOST = "https://api-sudop.uokik.gov.pl"
BASE = HOST + "/sudop-api/1.0.0"

#: "pomoc udzielana na naprawienie szkód wyrządzonych przez klęski żywiołowe" -
#: the purpose code, and what the flood grants are searched by.
#:
#: Not a measure number, on purpose. SA.116730 is the programme almost all of
#: this went out under, but not all: the same search bounded by the 2024 flood
#: instead of by the programme also returns 109 decisions under SA.117151,
#: preferential loans from the regional development agencies, which a search for
#: SA.116730 misses entirely. A purpose plus a date catches both and whatever
#: the next one is numbered.
#:
#: SA.115933 is quoted as the second flood measure elsewhere. It is not in
#: SUDOP's dictionary, appears on no decision, and searching for it is a 400.
DISASTER_PURPOSE = "a17"

#: The flood itself was September 2024; the first decisions are from the 25th.
#: The bound is what separates these grants from the 2010 flood programmes,
#: which carry the same purpose code.
FLOOD_FROM = "2024-09-01"

#: The programme most of it went out under, kept for looking one up directly.
FLOOD_MEASURE = "SA.116730"


class SudopError(RuntimeError):
    pass


def _request(url: str, attempts: int = 40) -> requests.Response:
    for attempt in range(attempts):
        try:
            response = requests.get(url, timeout=120, allow_redirects=False)
        except requests.RequestException as error:
            print(f"  network error, retrying: {error}")
            time.sleep(10)
            continue

        if response.status_code == 429:
            # Linear rather than exponential: the limit is per minute, so
            # doubling overshoots it by minutes without being any safer.
            time.sleep(8 + 2 * attempt)
            continue
        if response.status_code >= 400:
            raise SudopError(
                f"{response.status_code} from {url}: {response.text[:200]!r}"
            )
        return response

    raise SudopError(f"gave up after {attempts} attempts: {url}")


def search(
    params: dict[str, typing.Any], poll_seconds: int = 10, timeout: int = 1800
) -> list[dict]:
    """Runs one search to completion and returns its rows.

    `poll_seconds` is deliberately coarse. The queue's own estimate is 60
    seconds and it is optimistic - a whole measure takes four to five minutes -
    so a tighter poll only spends the rate limit on being told to wait again.
    """
    submitted = _request(
        BASE + "/api/przypadki-pomocy?" + _query(params),
    )
    if submitted.status_code != 303:
        raise SudopError(
            f"search was not queued (HTTP {submitted.status_code}): {params}"
        )

    queue = submitted.headers["location"]
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        polled = _request(HOST + queue)
        if polled.status_code == 303:
            result = _request(HOST + polled.headers["location"])
            return result.json().get("wyniki") or []
        time.sleep(poll_seconds)
    raise SudopError(f"queue never finished: {params}")


def _query(params: dict[str, typing.Any]) -> str:
    return "&".join(f"{key}={value}" for key, value in params.items())


def flood_decisions(since: str = FLOOD_FROM) -> list[dict]:
    """Every decision granted since the 2024 flood to repair disaster damage.

    9461 of them as of 2026-08-18, across two programmes.

    Paged, though a result this size arrives whole on the first page. The loop
    is here so that one which does get split is not silently truncated to it.
    """
    rows: list[dict] = []
    for page in range(1, 81):
        got = search(
            {
                "przeznaczenie-pomocy-kod": DISASTER_PURPOSE,
                "dzien-udzielenia-pomocy-od": since,
                "strona": page,
            }
        )
        print(f"a17 since {since}, page {page}: {len(got)} rows")
        if not got:
            break
        rows.extend(got)
    return rows


def dictionary(name: str) -> list[dict]:
    """One of the API's `slownik` endpoints, e.g. `srodek-pomocowy`.

    Worth checking a measure number against before searching for it: an unknown
    one is a 400 from the search endpoint with nothing to say which of the
    criteria it objected to.
    """
    return _request(f"{BASE}/slownik/{name}").json()
