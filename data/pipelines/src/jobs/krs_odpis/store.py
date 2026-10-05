"""Keeping the odpis PDFs, so a parse can be redone without a re-crawl.

The odpis pełny is the only uncensored source of names and PESELs in this
chain, it costs a request each, and until it was kept it was fetched, parsed in
memory and thrown away. That is the wrong thing to keep in RAM and drop from
storage, for one reason above all: **the parser has been wrong twice.**

A page footer split over two lines put its page count inside a person's name,
and the next person's ``L.p.`` counter was being appended to the previous
person's funkcja -- 533 of 1,782 people carried one. Both were found by looking
at the output, and fixing each meant re-fetching every document, because the
documents were gone. With them in the bucket a parser fix is a re-parse:
minutes, offline, and no load on a government service that nobody had to ask
for access to.

The same argument is why the api-krs scrape (`jobs.krs_scrape_free`) stores
every odpis rather than just the people it read out of one.

The bytes are filed before anyone parses them, under the name
`scrapers.krs.odpis_files.blob_name` gives them, and through a write that
raises when it does not land (`stores.storage.Client.create_object`): a crawler
that believed a lost upload would skip the company for good.
"""

import typing
from collections.abc import Callable, Sequence

from jobs.krs_odpis import search
from scrapers.krs import odpis_files

#: Files `data` under a blob name, and raises if it cannot. `create_object` on
#: the crawl bucket in a real run.
Put = Callable[[str, bytes], typing.Any]


def fetch_and_store(
    krs: str,
    registers: Sequence[str],
    put: Put,
    day: str,
    full: bool = True,
    session: typing.Any | None = None,
    timeout: float = search.CRAWL_TIMEOUT,
) -> tuple[str, bytes] | None:
    """Ask each register in turn; file the first odpis served before returning it.

    None when every register asked says the KRS is not in it. A register
    answering anything but a document or a "not here" raises
    `search.OdpisUnavailable`, and a dropped connection or one that answers
    nothing within `timeout` raises what `requests` raises: none of them is an
    answer about the company.
    """
    for register in registers:
        content = search.fetch_odpis_pdf(
            krs, register=register, full=full, session=session, timeout=timeout
        )
        if content:
            put(odpis_files.blob_name(krs, register, day, full=full), content)
            return register, content
    return None
