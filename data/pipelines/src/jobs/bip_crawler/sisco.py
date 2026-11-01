"""Reading SISCO eDc's BIPs: a page's attachments through the call its script
makes for them.

SISCO eDc (page templates by editore.pl) serves 20 units of the people mode
from one server (bip.brzeg.pl, hazlach.samorzady.pl, bip.um.opole.pl ...: 212
candidacies not found on 10-31). A document page lists its attachments in an
empty table, ``#fileList-<page>``, which its script fills: the page's
``$("#fileList-<page>").edDatatables("<base64>")`` holds the table's
``dataTableCfg``, and the rows come from a POST of it, DataTables' fields
around it in jQuery.param's form, to
``/scripts_ajax/serwis_datatable/ajx_dataTableEngine.php``. The answer is JSON
after a byte-order mark, ``{recordsTotal, data: [{Nazwa, Opis}]}``, ``Nazwa``
the file's link (``<a href="/uploaded_files/serwis_files/attachments/bip/
<page>/<hash>.pdf">Ewa Kozioł</a>``). The rows name the people; the walk saw
the empty tables.

`attachments` asks for them on a page whose title or breadcrumb says
oświadczenia (majątek alone is not enough: "Sprzedaż majątku" lists sale
notices), replaying the page's own configuration as its script does, and hands
them back as links: the file's name for the label, its description beside it
for the row, the breadcrumb's innermost sections for the heading. The page
keeps its own title, so it lends nobody's name to files that name somebody
else.
"""

from __future__ import annotations

import base64
import html
import json
import re
from collections.abc import Callable
from typing import Any
from urllib.parse import urljoin, urlsplit

from scrapers.bip.people import DECLARATION, fold
from scrapers.common.fetch import HttpResult, Payload
from scrapers.common.links import LinkContext

#: The walk's call (robots.txt, the host's rate, the POST): an answer, or why
#: there was none.
Post = Callable[[str, Payload], "HttpResult | str"]
ENGINE = "/scripts_ajax/serwis_datatable/ajx_dataTableEngine.php"
#: The breadcrumb's innermost sections a file's heading carries.
SECTIONS = 4

_TABLE = re.compile(r'\$\("#(fileList-[\w-]+)"\)\.edDatatables\("([A-Za-z0-9+/=]+)"\)')
_TRAIL = re.compile(r'<ol class="breadcrumb">(.*?)</ol>', re.S)
_ITEM = re.compile(r"<li\b[^>]*>(.*?)</li>", re.S)
_TAG = re.compile(r"<[^>]+>")
_LINK = re.compile(r"""<a\b[^>]*\bhref=(["'])(.*?)\1[^>]*>(.*?)</a>""", re.S)
_HOME = "strona domowa"


def _plain(fragment: str) -> str:
    return " ".join(html.unescape(_TAG.sub(" ", fragment)).split())


def _param(prefix: str, value: Any, pairs: list[tuple[str, str]]) -> None:
    """``value`` under ``prefix`` as jQuery.param writes it: options[a][b]=..."""
    if isinstance(value, dict):
        for key, inner in value.items():
            _param(f"{prefix}[{key}]", inner, pairs)
    elif isinstance(value, list):
        for i, inner in enumerate(value):
            _param(f"{prefix}[{i}]", inner, pairs)
    elif value is None:
        pairs.append((prefix, ""))
    elif isinstance(value, bool):
        pairs.append((prefix, "true" if value else "false"))
    else:
        pairs.append((prefix, str(value)))


def form(table: str, config: dict[str, Any]) -> list[tuple[str, str]]:
    """What the page's script sends for ``table``: DataTables' own fields, all
    rows at once, and the table's configuration as the page gives it."""
    pairs: list[tuple[str, str]] = [("draw", "1")]
    for i, column in enumerate(config.get("tableHeaderArr") or []):
        _param(
            f"columns[{i}]",
            {
                "data": column.get("data") if isinstance(column, dict) else "",
                "name": "",
                "searchable": True,
                "orderable": True,
                "search": {"value": "", "regex": False},
            },
            pairs,
        )
    _param("order[0]", {"column": 0, "dir": "asc"}, pairs)
    pairs += [("start", "0"), ("length", "-1")]
    _param("search", {"value": "", "regex": False}, pairs)
    pairs.append(("uniqueID", table))
    _param("options", config, pairs)
    pairs.append(("srv_inc", "1"))
    return pairs


def tables(content: bytes) -> list[tuple[str, dict[str, Any]]]:
    """The page's attachment tables, (id, configuration): ``#fileList-<n>``, not
    its child pages' ``#pageChildLinkList-<n>``, which the menu links anyway."""
    if b"edDatatables" not in content:
        return []
    out = []
    for found in _TABLE.finditer(content.decode("utf-8", "replace")):
        try:
            config = json.loads(base64.b64decode(found.group(2)))["dataTableCfg"]
        except (ValueError, KeyError, TypeError):
            continue
        if isinstance(config, dict):
            out.append((found.group(1), config))
    return out


def trail(content: bytes) -> list[str]:
    """The breadcrumb's sections, outermost first, without the home page."""
    found = _TRAIL.search(content.decode("utf-8", "replace"))
    items = [_plain(x) for x in _ITEM.findall(found.group(1))] if found else []
    return [x for x in items if x and fold(x) != _HOME]


def attachments(page: HttpResult, title: str, post: Post) -> list[LinkContext] | None:
    """The attachments of a declarations page, as links; None for a page that
    is none of SISCO's or says nothing of declarations, [] when the call gave
    no rows."""
    found = tables(page.content)
    if not found:
        return None
    sections = trail(page.content)
    if not DECLARATION.search(fold(title + " " + " ".join(sections))):
        return None
    parts = urlsplit(page.url)
    engine = f"{parts.scheme}://{parts.netloc}{ENGINE}"
    heading = " > ".join(sections[-SECTIONS:])
    links: list[LinkContext] = []
    for table, config in found:
        answer = post(engine, form(table, config))
        if isinstance(answer, str) or not answer.ok:
            continue
        try:
            data = json.loads(answer.content.decode("utf-8-sig"))
            rows = [r for r in data.get("data") or [] if isinstance(r, dict)]
        except (ValueError, AttributeError):
            continue
        for row in rows:
            link = _LINK.search(str(row.get("Nazwa") or ""))
            if link is None:
                continue
            label = _plain(link.group(3))
            about = _plain(str(row.get("Opis") or ""))
            links.append(
                LinkContext(
                    urljoin(page.url, html.unescape(link.group(2))),
                    label,
                    " ".join(x for x in (label, about) if x),
                    heading,
                )
            )
    return links
