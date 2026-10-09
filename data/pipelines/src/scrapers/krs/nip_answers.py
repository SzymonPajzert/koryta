"""Where the crawl bucket keeps what the register's search answered about a NIP.

`jobs.krs_nip` asks the service behind the register's search page which
entries hold a NIP, and files each answer here. Whoever reads them back needs
the same two things: what an answer is called, and what is on file. Like
`odpis_files`, this asks nothing of the service.

The search is a POST whose body is not in the URL, so an answer is filed under
a name that states the question instead:

    hostname=wyszukiwarka-krs-api.ms.gov.pl/api/wyszukiwarka/krs/nip/<nip>/date=<day>

``<day>`` is the Warsaw date it was asked. The body is
``{"nip": ..., "hits": [...]}``, each hit a `SearchHit` as a dict. Name and
body are those the CRU crawl's ``krs_nip_resolve.py`` filed its answers under,
so what it asked counts as asked. A NIP the register does not hold is filed
with no hits: that is an answer, not a gap, and is not asked again.
"""

import json
from dataclasses import dataclass, field

from scrapers.krs.odpis_files import PREFIX
from scrapers.stores import CloudStorage, Context
from scrapers.stores.file import DownloadableFile

#: Where under the service's host a search by NIP is filed.
SEARCH_PATH = "/api/wyszukiwarka/krs/nip/"


def blob_name(nip: str, day: str) -> str:
    """Where the answer about `nip` asked on `day` (Warsaw, ISO) is filed."""
    return f"{PREFIX}{SEARCH_PATH}{nip}/date={day}"


@dataclass(frozen=True)
class StoredAnswer:
    """An answer on file: about which NIP, and from which day."""

    nip: str
    day: str
    #: The blob name, as `blob_name` builds it.
    blob: str
    #: The listing's reference, which reads the bytes through the local cache.
    ref: DownloadableFile | None = field(default=None, compare=False)


def parse_listed(url: str) -> StoredAnswer | None:
    """A listed object's URL read back as a stored answer, or None if it is not one.

    An object filed twice in one day can carry a doubled ``date=X/date=X``,
    and is read by its last stamp, as `odpis_files.parse_listed` reads an odpis.
    """
    marker = PREFIX + SEARCH_PATH
    if marker not in url:
        return None
    tail = url.split(marker, 1)[1]
    nip = tail.split("/", 1)[0]
    if len(nip) != 10 or not nip.isdigit() or "/date=" not in tail:
        return None
    day = tail.rsplit("/date=", 1)[1]
    if not day:
        return None
    return StoredAnswer(nip=nip, day=day, blob=marker + tail)


def stored_answers(ctx: Context) -> dict[str, StoredAnswer]:
    """NIP to the newest answer on file about it, from one bucket listing."""
    newest: dict[str, StoredAnswer] = {}
    for ref in ctx.io.list_files(CloudStorage(prefix=PREFIX + SEARCH_PATH)):
        if not isinstance(ref, DownloadableFile):
            continue
        stored = parse_listed(ref.url)
        if stored is None:
            continue
        held = newest.get(stored.nip)
        if held is not None and held.day >= stored.day:
            continue
        newest[stored.nip] = StoredAnswer(
            nip=stored.nip, day=stored.day, blob=stored.blob, ref=ref
        )
    return newest


def hits_of(body: str) -> list[dict] | None:
    """The register entries an answer names, or None when the body is no answer.

    "Not in the register" is an empty list. An empty or unreadable body is a
    write that did not finish, so its NIP is asked again.
    """
    try:
        payload = json.loads(body)
    except ValueError:
        return None
    hits = payload.get("hits") if isinstance(payload, dict) else None
    if not isinstance(hits, list):
        return None
    return [hit for hit in hits if isinstance(hit, dict) and hit.get("krs")]
