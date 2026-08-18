"""NIP → KRS, from the Ministry of Finance's wykaz podatników VAT.

SUDOP names a beneficiary by NIP and nothing else, and koryta.pl addresses a
company by KRS: `Company.krsNumber` is set on all 3631 stored companies and
`nipNumber` on none of them. Something has to bridge the two, and the biała
lista is the only register that will do it in bulk without an account - public,
no key, thirty NIPs per request.

CRBR would have answered the same question and more, since it also names the
beneficial owners. It is no longer an option: since 2026 the register is not
openly searchable, access is granted on request to whoever can show an
uzasadniony interes under the AML rules, and the public search form is behind a
reCAPTCHA. What that costs this pipeline is nothing at all - koryta.pl already
reads ownership out of KRS, for every company it tracks - so the beneficiaries
this resolves are handed to the existing KRS pipeline rather than to a second
ownership source.

The white list's answer also carries a PESEL for a sole trader. It is read past
and never stored: `resolve` returns register numbers, and a beneficiary with no
KRS number is dropped rather than described.
"""

import datetime
import time
import typing

import requests

BASE = "https://wl-api.mf.gov.pl/api"

#: The endpoint's own cap on how many identifiers one request may carry.
BATCH = 30


class WhitelistError(RuntimeError):
    pass


def _get(url: str, params: dict[str, str], attempts: int = 8) -> dict:
    for attempt in range(attempts):
        try:
            response = requests.get(url, params=params, timeout=60)
        except requests.RequestException:
            time.sleep(2 + attempt)
            continue

        # 429 is the documented answer to going over ten requests a second.
        if response.status_code in (429, 503):
            time.sleep(2 + attempt)
            continue
        if response.status_code >= 400:
            raise WhitelistError(f"{response.status_code} from {url}")
        return response.json()

    raise WhitelistError(f"gave up after {attempts} attempts: {url}")


def _query_date() -> str:
    """Yesterday, because the list for today is not published until it is.

    Asking for a future date - and, briefly after midnight, for today - is a
    400, which would fail a pipeline for no reason other than when it happened
    to be run.
    """
    return (datetime.date.today() - datetime.timedelta(days=1)).isoformat()


def resolve(nips: typing.Iterable[str]) -> dict[str, dict[str, str]]:
    """Maps each NIP to what the register says about it, KRS included.

    Only NIPs the register answered for appear in the result, and only the three
    fields this pipeline has a use for. A missing entry and an entry without a
    `krs` mean different things - unknown to the register, versus known and not
    in KRS - and the caller distinguishes them, so neither is filled in here.

    Of the 3711 beneficiaries under SA.116730 the register knew 2793, and 748 of
    those were in KRS.
    """
    date = _query_date()
    unique = sorted({nip for nip in nips if nip})
    resolved: dict[str, dict[str, str]] = {}

    for start in range(0, len(unique), BATCH):
        chunk = unique[start : start + BATCH]
        payload = _get(f"{BASE}/search/nips/{','.join(chunk)}", {"date": date})
        entries = (payload.get("result") or {}).get("entries") or []
        for entry in entries:
            subjects = entry.get("subjects") or []
            if not subjects:
                continue
            # One NIP returns several subjects only where the register holds
            # historical entries for it; the current one is first.
            subject = subjects[0]
            resolved[entry["identifier"]] = {
                "name": subject.get("name") or "",
                "krs": subject.get("krs") or "",
                "regon": subject.get("regon") or "",
            }
        # Ten requests a second is the published limit and there is no hurry:
        # 3711 beneficiaries is 124 requests either way.
        time.sleep(0.2)

    return resolved
