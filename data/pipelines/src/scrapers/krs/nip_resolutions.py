"""What the register's own search has already answered, as an artifact.

`scripts.krs_nip_resolve resolve` asks the search about a NIP and files the
answer in the crawl bucket. Reading those answers back meant listing the
prefix and **downloading every body** -- 17,008 objects at the time of
writing -- and five call sites did it, once per invocation.

`KRSAlreadyScraped` is the model, and `cached_answers` cites it in its own
docstring without following it all the way. That pipeline answers "was this
asked" from the listing alone and says so: *"Told apart by the size the
listing already carries, so no body is read here."* This one cannot -- the
answer is in the body, not the key -- so it reads them once, here, and writes
what it found. A reader then opens one JSONL instead of 17,008 objects.

**One row per (NIP, KRS) pair**, not per NIP, because a NIP reaches several
register entries and each carries its own name: EMITEL is "SPÓŁKA AKCYJNA"
under 0000716108 and "SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ" under
0000482636, and flattening to the open entry would lose which era a board sat
in. `position` 0 is that open entry.

A NIP whose answer found nothing is kept, as a single row with `found` false
and an empty `krs`. That is a result and not a gap: re-asking it every run is
the mistake `cached_answers` already refuses to make, and the row is what lets
a reader tell "asked, nothing there" from "never asked".

**Not authoritative for `resolve`.** This is a snapshot, so a `resolve` that
trusted it would re-ask for every NIP answered since it was built -- real
requests against a government service. `resolve` and `fetch` read the bucket;
only the reporting and consuming paths read this.
"""

import json
from dataclasses import dataclass

import pandas as pd

from scrapers.krs import nip_lookup
from scrapers.stores import CloudStorage, Context, Pipeline
from scrapers.stores.file import DownloadableFile

#: Where a NIP search is filed in the crawl bucket. Not a real route -- the
#: search is a POST and its body is not in the URL -- but it identifies the
#: question, which is what the store needs of a key.
SEARCH_URL = "https://wyszukiwarka-krs-api.ms.gov.pl/api/wyszukiwarka/krs/nip/{nip}"

#: The bucket prefix every one of those lands under.
SEARCH_PREFIX = "hostname=wyszukiwarka-krs-api.ms.gov.pl"

#: The marker inside a stored key that says "this blob is a NIP search".
NIP_SEGMENT = "/wyszukiwarka/krs/nip/"


def krs_entries_of(payload: dict) -> tuple[str, ...]:
    """Every KRS a stored search found for this NIP, the open entry first.

    More than one hit used to resolve to nothing, on the reading that it meant
    more than one subject. It does not: a NIP belongs to one taxpayer, so the
    extra rows are that taxpayer's earlier register entries. The register says
    so itself -- NIP 5272703675 returns 0000482636 and 0000716108, the odpis
    of the first is stamped ``WYKREŚLENIE Z KRAJOWEGO REJESTRU SĄDOWEGO`` on
    27.02.2018 and the second records its own origin as ``PRZEKSZTAŁCENIE`` of
    that company.

    Refusing them cost the CRU population **1,272 recipients carrying
    746,378,072 PLN** -- 97% of all the money it could not resolve -- among
    them EMITEL, TEXOM and CATERMED, which are companies we plainly want.
    """
    hits = payload.get("hits") or []
    return nip_lookup.newest_first(h.get("krs") for h in hits if h.get("krs"))


def names_of(payload: dict) -> dict[str, str]:
    """KRS to the name the register printed for it, from a stored search answer.

    Each entry carries its own: a transformed company is "EMITEL SPÓŁKA
    AKCYJNA" under 0000716108 and "EMITEL SPÓŁKA Z OGRANICZONĄ
    ODPOWIEDZIALNOŚCIĄ" under 0000482636, and labelling both with the open
    entry's name would hide which era a board sat in.

    Free, in the sense that it is read out of an answer already on file --
    `parse_search` has kept `nazwa` all along and nothing downstream asked for
    it, so every company the run did not separately hold went unnamed.
    """
    names: dict[str, str] = {}
    for hit in payload.get("hits") or []:
        krs = nip_lookup.newest_first(hit.get("krs"))
        if krs and hit.get("name"):
            names[krs[0]] = str(hit["name"])
    return names


def krs_of(payload: dict) -> str | None:
    """The open register entry a stored search found, or None if it found none."""
    entries = krs_entries_of(payload)
    return entries[0] if entries else None


def nip_and_date(url: str) -> tuple[str, str] | None:
    """The NIP a stored search asked about and when, or None if it is not one."""
    if NIP_SEGMENT not in url:
        return None
    tail = url.split(NIP_SEGMENT, 1)[1]
    nip, _, stamp = tail.partition("/date=")
    nip = "".join(c for c in nip if c.isdigit())
    return (nip, stamp) if len(nip) == 10 else None


def newest_blob_per_nip(
    ctx: Context,
) -> dict[str, tuple[str, DownloadableFile]]:
    """The latest search answer on file for each NIP, without reading a body.

    Split out from the read so the listing can be counted and reported before
    17,008 downloads start, and so a test can drive the read half directly.
    """
    newest: dict[str, tuple[str, DownloadableFile]] = {}
    for ref in ctx.io.list_files(CloudStorage(prefix=SEARCH_PREFIX)):
        if not isinstance(ref, DownloadableFile):
            continue
        parsed = nip_and_date(ref.url)
        if parsed is None:
            continue
        nip, stamp = parsed
        if nip in newest and newest[nip][0] >= stamp:
            continue
        newest[nip] = (stamp, ref)
    return newest


@dataclass
class NipResolution:
    """One register entry a NIP search reached, or the fact that it reached none."""

    nip: str
    krs: str
    #: 0 is the open entry, the one `krs_of` returns. Higher is further back.
    position: int
    #: The name the register printed for *this* entry, not for the taxpayer.
    name: str
    #: The crawl stamp of the answer this row came from.
    date: str
    #: False on the single row that stands for "asked, and the register had
    #: nothing". Distinguishing that from a NIP nobody asked about is the
    #: reason the row exists at all.
    found: bool


def rows_for(nip: str, payload: dict, date: str) -> list[NipResolution]:
    entries = krs_entries_of(payload)
    if not entries:
        return [NipResolution(nip, "", 0, "", date, False)]
    names = names_of(payload)
    return [
        NipResolution(nip, krs, position, names.get(krs, ""), date, True)
        for position, krs in enumerate(entries)
    ]


class KrsNipResolutions(Pipeline):
    """Every NIP the register's own search has answered, and what it answered."""

    filename = "krs_nip_resolutions"

    # Identifiers, never numbers. A KRS is a zero-padded 10-digit string and a
    # NIP is a 10-digit string; pandas reads either as an integer without this
    # and the leading zeros are gone for good.
    dtype = {"nip": str, "krs": str, "name": str, "date": str}

    def process(self, ctx: Context):
        newest = newest_blob_per_nip(ctx)
        print(f"  {len(newest):,} NIPs have a search answer on file")

        rows: list[NipResolution] = []
        empty = 0
        unreadable = 0
        for nip, (date, ref) in sorted(newest.items()):
            try:
                body = ctx.io.read_data(ref).read_string()
                payload = json.loads(body) if body else {}
            except Exception:  # noqa: BLE001 - an unreadable blob is not fatal
                unreadable += 1
                payload = {}
            built = rows_for(nip, payload, date)
            if not built[0].found:
                empty += 1
            rows.extend(built)

        print(
            f"  {len(rows):,} register entries, "
            f"{empty:,} NIPs the register had nothing for"
            + (f", {unreadable:,} blobs unreadable" if unreadable else "")
        )
        return pd.DataFrame.from_records([vars(row) for row in rows])


def payloads_from_artifact(path) -> dict[str, dict]:
    """The artifact, read back in the shape the stored answers have.

    Deliberately reconstructs `{"hits": [...]}` rather than exposing the rows,
    so every consumer keeps calling `krs_entries_of` and `names_of` on a value
    that means the same thing whether it came from one JSONL or from 17,008
    objects. The alternative is two code paths that agree until they do not.
    """
    payloads: dict[str, dict] = {}
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            row = json.loads(line)
            nip = str(row.get("nip") or "")
            if not nip:
                continue
            payload = payloads.setdefault(nip, {"hits": []})
            if row.get("found"):
                payload["hits"].append(
                    {"krs": str(row.get("krs") or ""), "name": row.get("name") or ""}
                )
    return payloads
