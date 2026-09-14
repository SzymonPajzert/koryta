"""Turning a NIP into a KRS number.

Every source this pipeline wants to join against KRS identifies a company by
NIP and not by KRS. CRU does (`entities.cru.CruStrona.nip`), and so does every
spend spreadsheet a public body publishes. KRS itself is keyed on the KRS
number, and **neither ministry endpoint offers a search by NIP**: `api-krs`
serves ``OdpisAktualny/<krs>`` and ``OdpisPelny/<krs>`` only, and the public
search service's own API is reached per-KRS as well.

So the mapping has to come from somewhere else, and there are two places:

**The crawl we already have.** Every ``OdpisAktualny`` response carries
``dzial1.danePodmiotu.identyfikatory.nip``, so each company ever fetched is one
NIP-to-KRS pair sitting in the cache. Free, offline, instant -- and limited to
companies already crawled, which is the set this work exists to grow.

**The Ministry of Finance's wykaz podatników VAT** ("biała lista"), whose
``search`` method returns a ``krs`` field. Public, unauthenticated, documented
-- and rate-limited to **100 requests per day of at most 30 subjects each**, so
3,000 NIPs a day and no more. That ceiling decides how this can be used: a
1,156-NIP spreadsheet is 39 requests and fits in one day, while the 61,453
distinct NIPs in CRU would take three weeks. Batching is therefore not an
optimisation here, it is the difference between feasible and not, and
`MF_BATCH_SIZE` is a published limit rather than a tuning knob.

A NIP that resolves to no KRS is a real answer, not a failure: 25,355 of CRU's
counterparties are sole traders, who are in CEIDG and have no KRS at all. The
caller needs to tell "not in KRS" from "not asked yet", so `NipResolution`
records which source answered.
"""

import json
import pathlib
import re
import time
import typing
from dataclasses import dataclass

import requests

MF_SEARCH_URL = "https://wl-api.mf.gov.pl/api/search/nips/{nips}?date={date}"

#: Subjects per request, per the published limit. Not tunable.
MF_BATCH_SIZE = 30

#: Requests per day, per the published limit. Exceeding it locks the IP out
#: until midnight, so a run that would cross it must stop instead.
MF_DAILY_REQUESTS = 100

USER_AGENT = "koryta.pl-pipeline/1.0 (https://github.com/SzymonPajzert/koryta)"

#: Seconds between requests. The daily cap is the real constraint; this only
#: keeps a burst from looking like one.
REQUEST_INTERVAL = 1.0

_NIP_WEIGHTS = (6, 5, 7, 2, 3, 4, 5, 6, 7)


class MfQuotaExhausted(RuntimeError):
    """The wykaz refused us for the rest of the day."""


def only_digits(value: typing.Any) -> str:
    return re.sub(r"\D", "", str(value or ""))


def nip_valid(nip: str) -> bool:
    """Whether this is ten digits with a correct check digit.

    Worth doing before spending a request: a NIP read out of a spreadsheet's
    free text is often truncated. Of the 1,156 distinct NIPs in the 2025-26
    sponsorship lists, 6 fail this and 15 rows carry only nine digits -- errors
    in the published source, not in the reader.
    """
    if len(nip) != 10 or not nip.isdigit():
        return False
    checksum = sum(int(d) * w for d, w in zip(nip, _NIP_WEIGHTS)) % 11
    return checksum != 10 and checksum == int(nip[9])


@dataclass(frozen=True)
class NipResolution:
    """What a NIP turned out to be."""

    nip: str
    krs: str | None
    name: str | None = None
    regon: str | None = None
    #: ``cache`` (an odpis already crawled), ``mf`` (the wykaz), or
    #: ``invalid``. Kept so that "has no KRS" is distinguishable from "nobody
    #: has asked yet" -- the two look identical in a column of nulls.
    source: str = "mf"
    #: The wykaz's ``statusVat``: "Czynny", "Zwolniony", or absent for an
    #: entity it does not hold.
    vat_status: str | None = None

    @property
    def in_krs(self) -> bool:
        return bool(self.krs)


def _pad_krs(value: typing.Any) -> str | None:
    digits = only_digits(value)
    return digits.rjust(10, "0") if digits else None


def parse_mf_response(payload: dict) -> dict[str, NipResolution]:
    """The response, keyed by the NIP each entry answers for.

    The shape, verified against the live service on 2026-09-13, is
    ``result.entries[]`` where each entry is ``{"identifier": "<nip>",
    "subjects": [ {...} ]}`` and a subject carries ``krs``, ``nip``, ``regon``,
    ``name`` and ``statusVat`` among twenty-odd fields.

    Two things make it necessary to read by identifier rather than by position:
    the entries do not come back in the order they were asked for, and a NIP
    the wykaz holds nothing for still gets an entry -- with an empty
    ``subjects`` -- which is a meaningful answer ("not a registered VAT payer")
    and not a gap.
    """
    out: dict[str, NipResolution] = {}
    for entry in (payload.get("result") or {}).get("entries") or []:
        if not isinstance(entry, dict):
            continue
        subjects = [s for s in entry.get("subjects") or [] if isinstance(s, dict)]
        identifier = only_digits(entry.get("identifier"))

        if not subjects:
            if identifier:
                out[identifier] = NipResolution(
                    nip=identifier, krs=None, source="mf"
                )
            continue

        for subject in subjects:
            nip = only_digits(subject.get("nip")) or identifier
            if not nip:
                continue
            out[nip] = NipResolution(
                nip=nip,
                krs=_pad_krs(subject.get("krs")),
                name=subject.get("name"),
                regon=only_digits(subject.get("regon")) or None,
                source="mf",
                vat_status=subject.get("statusVat"),
            )
    return out


def fetch_mf_batch(
    nips: typing.Sequence[str], date: str, opener: typing.Any | None = None
) -> dict[str, NipResolution]:
    """One wykaz request for up to `MF_BATCH_SIZE` NIPs.

    :param date: the day to ask about, ``YYYY-MM-DD``. Required by the API and
        not defaulted here: the answer is as-of a date, and a pipeline that
        silently asked about "today" would give different results on reruns.
    """
    if len(nips) > MF_BATCH_SIZE:
        raise ValueError(
            f"the wykaz takes at most {MF_BATCH_SIZE} subjects per request, "
            f"got {len(nips)}"
        )
    url = MF_SEARCH_URL.format(nips=",".join(nips), date=date)
    get = opener or requests.get
    response = get(url, headers={"User-Agent": USER_AGENT}, timeout=60)

    if response.status_code == 429:
        raise MfQuotaExhausted(
            "the wykaz podatnikow VAT has cut us off for today "
            f"({MF_DAILY_REQUESTS} requests / "
            f"{MF_DAILY_REQUESTS * MF_BATCH_SIZE} subjects)"
        )
    if response.status_code == 400:
        # One malformed NIP fails the whole batch, so name the culprits rather
        # than leaving a caller to bisect 30 numbers.
        bad = [n for n in nips if not nip_valid(n)]
        raise ValueError(
            f"the wykaz rejected the batch; malformed NIPs: {bad or 'none'}"
        )
    response.raise_for_status()
    return parse_mf_response(response.json())


def known_from_companies_merged(
    path: "pathlib.Path | None",
) -> tuple[dict[str, str], dict[str, str]]:
    """NIP-to-KRS pairs, and KRS-to-name, from companies we already hold.

    Free, offline, and the first thing to try: every row here is a wykaz
    request not spent and a search request not made. `companies_merged` carries
    a NIP for about 93% of its KRS-bearing rows -- 15,402 pairs, of which 1,512
    fall in the 18,364 KRS-form CRU counterparties and carry 29.9% of their
    9.57 bn PLN. Small in share, large in money, which is why asking the
    ministry about them again is the expensive kind of waste.

    A missing file is not an error: the artifact is a pipeline output, and a
    checkout that has not built it should degrade to asking rather than fail.
    """
    known: dict[str, str] = {}
    names: dict[str, str] = {}
    if path is None or not path.is_file():
        return known, names
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            row = json.loads(line)
            nip = only_digits(row.get("nip"))
            krs = only_digits(row.get("krs"))
            if len(nip) != 10 or not krs:
                continue
            padded = krs.rjust(10, "0")
            known.setdefault(nip, padded)
            if row.get("name"):
                names.setdefault(padded, str(row["name"]))
    return known, names


def resolve(
    nips: typing.Iterable[str],
    date: str,
    known: typing.Mapping[str, str] | None = None,
    max_requests: int = MF_DAILY_REQUESTS,
    opener: typing.Any | None = None,
    progress: typing.Callable[[int, int], None] | None = None,
) -> dict[str, NipResolution]:
    """Resolve every NIP, taking the free answers first.

    `known` is a NIP-to-KRS mapping from data already held -- see
    `krs_from_cached_odpisy` -- and every hit in it is a request not spent
    against the daily cap.

    Stops at `max_requests` rather than pressing on, because overrunning the
    cap locks the IP out for the rest of the day and would cost the *next* run
    too. What was not reached simply has no entry, so a later run picks it up.
    """
    known = known or {}
    out: dict[str, NipResolution] = {}
    to_ask: list[str] = []

    for raw in nips:
        nip = only_digits(raw)
        if nip in out or any(nip == pending for pending in to_ask):
            continue
        if not nip_valid(nip):
            out[nip] = NipResolution(nip=nip, krs=None, source="invalid")
            continue
        if nip in known:
            out[nip] = NipResolution(
                nip=nip, krs=_pad_krs(known[nip]), source="cache"
            )
            continue
        to_ask.append(nip)

    batches = [
        to_ask[i : i + MF_BATCH_SIZE] for i in range(0, len(to_ask), MF_BATCH_SIZE)
    ]
    for index, batch in enumerate(batches):
        if index >= max_requests:
            break
        if index:
            time.sleep(REQUEST_INTERVAL)
        answers = fetch_mf_batch(batch, date=date, opener=opener)
        for nip in batch:
            out[nip] = answers.get(
                nip, NipResolution(nip=nip, krs=None, source="mf")
            )
        if progress:
            progress(index + 1, len(batches))

    return out
