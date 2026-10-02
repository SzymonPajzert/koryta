"""Where the crawl bucket keeps the odpisy the ministry's search service served.

`jobs.krs_odpis` fetches each odpis and files it; the pipelines read them back.
This module is the part both need: what a stored odpis is called, and what is
on file. It asks nothing of the service, and lists the bucket at most once.

A blob is named the way `stores.storage.Client.upload` names a URL, which is
how every odpis crawled before the job existed was filed:

    hostname=wyszukiwarka-krs-api.ms.gov.pl/api/wyszukiwarka/OdpisPelny/pdf/<P|S>/<krs>/date=<day>

``<day>`` is the Warsaw date it was fetched. The odpis is a POST and its body is
not in the URL, so the name states the question instead: which kind of odpis,
from which register, about which KRS. ``OdpisPelny`` and ``OdpisAktualny`` are
different documents -- the aktualny drops every struck-out row -- and filing
one under the other's name would hand a later reader the wrong answer with no
way to tell.
"""

from dataclasses import dataclass, field

from scrapers.stores import CloudStorage, Context
from scrapers.stores.file import DownloadableFile

HOST = "wyszukiwarka-krs-api.ms.gov.pl"
PREFIX = f"hostname={HOST}"

#: The two registers an odpis can come from: przedsiębiorcy, then stowarzyszenia
#: (which also holds fundacje, SPZOZ hospitals, cechy and izby).
REGISTERS = ("P", "S")


def pad_krs(krs: str) -> str:
    """A KRS as the register writes it: ten digits, zero-filled from the left."""
    krs = str(krs).strip()
    if not krs.isdigit() or len(krs) > 10:
        raise ValueError(f"not a KRS number: {krs!r}")
    return krs.rjust(10, "0")


def _kind(full: bool) -> str:
    return "OdpisPelny" if full else "OdpisAktualny"


def odpis_path(krs: str, register: str, full: bool = True) -> str:
    """The path of the question an odpis answers, as its blob name spells it."""
    if register not in REGISTERS:
        raise ValueError(f"not a register: {register!r}")
    return f"/api/wyszukiwarka/{_kind(full)}/pdf/{register}/{pad_krs(krs)}"


def blob_name(krs: str, register: str, day: str, full: bool = True) -> str:
    """Where the odpis of `krs` fetched on `day` (Warsaw, ISO) is filed."""
    return f"{PREFIX}{odpis_path(krs, register, full)}/date={day}"


@dataclass(frozen=True)
class StoredOdpis:
    """An odpis on file: which register served it, and on which day."""

    krs: str
    register: str
    day: str
    #: The blob name, as `blob_name` builds it.
    blob: str
    #: The listing's reference, which reads the bytes through the local cache.
    ref: DownloadableFile | None = field(default=None, compare=False)


def parse_listed(url: str, full: bool = True) -> StoredOdpis | None:
    """A listed object's URL read back as a stored odpis, or None if it is not one.

    The listing hands back ``gs://<bucket>/hostname=<host>/...``, so the blob
    name is everything from the prefix on. NIP search answers live under the
    same host and are not odpisy; an object filed twice in one day can carry a
    doubled ``date=X/date=X`` and is read by its last stamp.
    """
    marker = f"/{_kind(full)}/pdf/"
    if marker not in url or PREFIX not in url:
        return None
    tail = url.split(marker, 1)[1]
    parts = tail.split("/")
    if len(parts) < 3 or parts[0] not in REGISTERS:
        return None
    krs = parts[1]
    if len(krs) != 10 or not krs.isdigit():
        return None
    day = tail.split("/date=")[-1] if "/date=" in tail else ""
    if not day:
        return None
    blob = PREFIX + url.split(PREFIX, 1)[1]
    return StoredOdpis(krs=krs, register=parts[0], day=day, blob=blob)


def stored_odpisy(ctx: Context, full: bool = True) -> dict[str, StoredOdpis]:
    """KRS number to the newest odpis on file for it, from one bucket listing.

    One listing rather than a HEAD per company: at 18,000 companies the
    per-object form is the hour-long shape `extract_people` warns about.
    """
    newest: dict[str, StoredOdpis] = {}
    for ref in ctx.io.list_files(CloudStorage(prefix=PREFIX, binary=True)):
        if not isinstance(ref, DownloadableFile):
            continue
        stored = parse_listed(ref.url, full=full)
        if stored is None:
            continue
        held = newest.get(stored.krs)
        if held is not None and held.day >= stored.day:
            continue
        newest[stored.krs] = StoredOdpis(
            krs=stored.krs,
            register=stored.register,
            day=stored.day,
            blob=stored.blob,
            ref=ref,
        )
    return newest
