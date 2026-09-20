"""Keeping the odpis PDFs, so a parse can be redone without a re-crawl.

The odpis pełny is the only uncensored source of names and PESELs in this
chain, it costs a request each, and until now it was fetched, parsed in memory
and thrown away. That is the wrong thing to keep in RAM and drop from storage,
for one reason above all: **the parser has been wrong twice.**

A page footer split over two lines put its page count inside a person's name,
and the next person's ``L.p.`` counter was being appended to the previous
person's funkcja -- 533 of 1,782 people carried one. Both were found by looking
at the output, and fixing each meant re-fetching every document, because the
documents were gone. With them in the bucket a parser fix is a re-parse:
minutes, offline, and no load on a government service that nobody had to ask
for access to.

The same argument is why `scraper.py` stores every api-krs odpis rather than
just the people it read out of one.

**The URL is synthetic.** The odpis is a POST and its body is not in the URL,
so `blob_url` names the question instead -- ``…/OdpisPelny/pdf/<krs>`` -- which
is what a key is for. Stored bytes are the service's verbatim response;
verified byte-identical on the round trip.
"""

import typing

from scrapers.krs import search
from scrapers.stores import CloudStorage, Context
from scrapers.stores.file import DownloadableFile, GCSBlob

#: Where an odpis is filed. `full` is part of the path because a pełny and an
#: aktualny of the same company are different documents -- the aktualny drops
#: every struck-out row -- and storing one under the other's name would hand a
#: later reader the wrong answer with no way to tell.
BLOB_URL = (
    "https://wyszukiwarka-krs-api.ms.gov.pl/api/wyszukiwarka/"
    "{kind}/pdf/{register}/{krs}"
)

PREFIX = "hostname=wyszukiwarka-krs-api.ms.gov.pl"

#: The segment that says "this blob is an odpis", as opposed to a NIP search.
_ODPIS_SEGMENT = "/pdf/"


def blob_url(krs: str, register: str, full: bool = True) -> str:
    return BLOB_URL.format(
        kind="OdpisPelny" if full else "OdpisAktualny",
        register=register,
        krs=search.pad_krs(krs),
    )


def stored_odpisy(ctx: Context, full: bool = True) -> dict[str, str]:
    """KRS number to the newest stored blob name, for odpisy already on file.

    One listing rather than a HEAD per company: at 18,000 companies the
    per-object form is the hour-long shape `extract_people` warns about.
    """
    kind = "OdpisPelny" if full else "OdpisAktualny"
    newest: dict[str, tuple[str, str]] = {}
    for ref in ctx.io.list_files(CloudStorage(prefix=PREFIX)):
        if not isinstance(ref, DownloadableFile):
            continue
        url = ref.url
        if f"/{kind}{_ODPIS_SEGMENT}" not in url:
            continue
        tail = url.split(f"/{kind}{_ODPIS_SEGMENT}", 1)[1]
        parts = tail.split("/")
        if len(parts) < 2:
            continue
        krs = "".join(c for c in parts[1] if c.isdigit())
        stamp = tail.split("/date=")[-1] if "/date=" in tail else ""
        if len(krs) != 10:
            continue
        if krs in newest and newest[krs][0] >= stamp:
            continue
        # The listing hands back a live URL; reading needs the blob name, which
        # is the URL with its scheme and host replaced by the prefix.
        blob = PREFIX + url.split("wyszukiwarka-krs-api.ms.gov.pl", 1)[1]
        newest[krs] = (stamp, blob)
    return {krs: blob for krs, (_, blob) in newest.items()}


def read_stored(ctx: Context, blob_name: str) -> bytes:
    return ctx.io.read_data(GCSBlob(blob_name=blob_name)).read_bytes()


def fetch_and_store(
    ctx: Context,
    krs: str,
    full: bool = True,
    session: typing.Any | None = None,
) -> tuple[str, bytes] | None:
    """Fetch an odpis and put it in the bucket before parsing it.

    Uploaded before the parse, deliberately: a document that crashes the parser
    is exactly the one worth having on disk, and storing it afterwards would
    lose precisely those.
    """
    fetched = search.fetch_odpis_pdf_either(krs, full=full, session=session)
    if fetched is None:
        return None
    register, content = fetched
    ctx.io.upload(
        blob_url(krs, register, full=full),
        content,
        "application/pdf",
        include_query=True,
        verbose=False,
    )
    return register, content
