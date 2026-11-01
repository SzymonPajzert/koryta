"""Reading the declarations FINN's BIPs keep in FINN e-Urząd.

FINN's BIPs (bip.powiatwodzislawski.pl, bip.raciborz.pl, bip.radomsko.pl ...:
15 units, 419 candidacies of the people mode on 10-31) show a council's
declarations in an iframe of e-Urząd, ``https://eurzad.finn.pl/<client>/#!/
rejestry/<symbol>/...``, its address entity-encoded; the walk read the page and
found no file on it. The app, one host for every FINN client, draws a register
from JSON-RPC calls, each a POST of ``{"id": 1, "method": ..., "params": [...]}``
to ``https://eurzad.finn.pl/<client>/rpc/routeRejestryServiceManager<N>``, every
param and the answer's ``result`` JSON in a string:

- N=0, no params: the client's registers, ``[{symbol, nazwa}]``;
- N=1, ``[symbol, "1000", page, "DEFAULT", {}]``: a register's records,
  ``{lista: [{id, temat, dataW, aktZal}], liczbaStron}``, a thousand a page;
- N=2, ``[id]``: one record, its files ``{zalaczniki: [{id, nazwa}]}``.

A file comes down from ``/<client>/server/pobierz_rejestry_zalacznik/<id>``,
which answers 303 to the file on `FILES`.

`Eurzad.registers` hands the walk a client's declaration registers as pages of
links it judges like any other: the file's name for a link's label, the
record's subject ("Oświadczenie majątkowe za 2025 rok radnej Anny
Piotrowskiej") for its row, the register's name for the page's title. A record
is opened, a call each, when it may be a seeker's: its subject names one by
first name too, `per_person` records a person, newest first, the council's
registers before the rest; in the council's registers also, for a person no
subject names so, a subject that names their surname alone, and the newest few
that name nobody at all. The rest (staff, the mayor among them, and the
units' offices) offer only subjects that name a seeker by first name: their
surnames alone are as likely a namesake's.
"""

from __future__ import annotations

import html
import json
import re
import threading
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, TypeVar
from urllib.parse import quote

from scrapers.bip.people import (
    ASSETS,
    DECLARATION,
    Seeker,
    fold,
    named_by,
    names_somebody,
)
from scrapers.common.fetch import HttpResult
from scrapers.common.links import LinkContext

EURZAD = "https://eurzad.finn.pl"
#: Where e-Urząd keeps its files, behind a 303 from their addresses (10-31).
FILES = "https://res.finn.pl/eurzad/"
#: Records of a council's register that name nobody, opened newest first: one
#: may hold the whole council's files, each named by its councillor alone.
UNNAMED = 3
#: Pages of a register's records read, a thousand records each.
MAX_PAGES = 5
#: The walk's call (robots.txt, the host's rate, the POST): an answer, or why
#: there was none (``people.ROBOTS``, ``people.UNREACHABLE``).
Post = Callable[[str, dict[str, Any]], "HttpResult | str"]

_CLIENT = re.compile(r"https?://eurzad\.finn\.pl/([A-Za-z0-9_-]+)")
#: A council's register, when the seekers' offices name none (`office_terms`).
_COUNCIL = re.compile(r"(?:^| )(?:radn\w*|rad[ay])(?= |$)")

_T = TypeVar("_T")


def clients(content: bytes, url: str) -> list[str]:
    """The e-Urząd clients a page embeds or links, entity-encoded as FINN's
    iframes are (``https&#x3a;&#x2f;&#x2f;eurzad&#x2e;finn...``), or that its
    own address is one of."""
    head = content[:500_000]
    if b"eurzad" not in head.lower() and "eurzad" not in url.lower():
        return []
    text = html.unescape(head.decode("utf-8", "replace")) + " " + url
    return list(dict.fromkeys(m.group(1) for m in _CLIENT.finditer(text)))


@dataclass(frozen=True)
class Register:
    """One declaration register, as a page of the walk: the app's address of
    it, its name, and the files of the records opened."""

    url: str
    name: str
    links: tuple[LinkContext, ...]


class Eurzad:
    """The e-Urząd clients a run meets, each register and record read once.
    Thread-safe: walks of different units share one."""

    def __init__(self, post: Post) -> None:
        self.post = post
        self._lock = threading.Lock()
        self._declarations: dict[str, list[dict[str, Any]]] = {}
        self._records: dict[tuple[str, str], list[dict[str, Any]]] = {}
        self._files: dict[tuple[str, str], list[dict[str, Any]]] = {}

    # -- the API ---------------------------------------------------------------
    def _call(self, client: str, route: int, params: list[str]) -> Any:
        """A route's answer; None when there was none (a failure, robots.txt,
        a "not now"), which is not kept: a later walk asks again."""
        method = f"/rpc/routeRejestryServiceManager{route}"
        answer = self.post(
            f"{EURZAD}/{client}{method}", {"id": 1, "method": method, "params": params}
        )
        if isinstance(answer, str) or not answer.ok:
            return None
        try:
            return json.loads(json.loads(answer.content)["result"])
        except (ValueError, KeyError, TypeError):
            return None

    def _kept(
        self, cache: dict[Any, _T], key: Any, load: Callable[[], _T | None]
    ) -> _T | None:
        with self._lock:
            if key in cache:
                return cache[key]
        value = load()
        if value is None:
            return None
        with self._lock:
            return cache.setdefault(key, value)

    def declarations(self, client: str) -> list[dict[str, Any]] | None:
        """The client's registers of oświadczenia majątkowe; None when the app
        did not answer."""

        def load() -> list[dict[str, Any]] | None:
            data = self._call(client, 0, [])
            if not isinstance(data, list):
                return None
            return [
                r
                for r in data
                if isinstance(r, dict)
                and DECLARATION.search(fold(r.get("nazwa")))
                and ASSETS.search(fold(r.get("nazwa")))
            ]

        return self._kept(self._declarations, client, load)

    def records(self, client: str, symbol: str) -> list[dict[str, Any]]:
        """A register's records that have files, newest first."""

        def load() -> list[dict[str, Any]] | None:
            found: list[dict[str, Any]] = []
            page = pages = 1
            while page <= min(pages, MAX_PAGES):
                params = [json.dumps(symbol), "1000", str(page), '"DEFAULT"', "{}"]
                data = self._call(client, 1, params)
                if not isinstance(data, dict):
                    return None
                found += [r for r in data.get("lista") or [] if isinstance(r, dict)]
                pages = _number(data.get("liczbaStron"))
                page += 1
            # aktZal 0: a record whose files were taken down.
            found = [r for r in found if str(r.get("aktZal", 1)) != "0"]
            return sorted(found, key=lambda r: str(r.get("dataW") or ""), reverse=True)

        return self._kept(self._records, (client, symbol), load) or []

    def files(self, client: str, record: str) -> list[dict[str, Any]]:
        """A record's files."""

        def load() -> list[dict[str, Any]] | None:
            data = self._call(client, 2, [record])
            if not isinstance(data, dict):
                return None
            return [
                z
                for z in data.get("zalaczniki") or []
                if isinstance(z, dict) and z.get("id") is not None
            ]

        return self._kept(self._files, (client, record), load) or []

    # -- what the walk reads ---------------------------------------------------
    def registers(
        self,
        client: str,
        seekers: list[Seeker],
        prefer: re.Pattern[str] | None = None,
        first_names: frozenset[str] = frozenset(),
        per_person: int = 3,
    ) -> list[Register]:
        """The client's declaration registers, each with the files of the
        records that may be the seekers' (see the module) as its links; [] when
        the app did not answer."""
        registers = self.declarations(client) or []
        council = [
            bool((prefer or _COUNCIL).search(fold(r.get("nazwa")))) for r in registers
        ]
        rows = [
            (k, record)
            for k, register in enumerate(registers)
            for record in self.records(client, str(register.get("symbol")))
        ]
        # Newest first, the council's before the rest: a councillor's records
        # of two terms stand in two registers.
        rows.sort(key=lambda row: str(row[1].get("dataW") or ""), reverse=True)
        rows.sort(key=lambda row: not council[row[0]])
        by_first: Counter[tuple[str, str]] = Counter()
        unnamed: Counter[int] = Counter()
        opened: set[int] = set()
        surname_only: list[tuple[int, list[Seeker]]] = []
        for i, (k, record) in enumerate(rows):
            subject = str(record.get("temat") or "")
            named, namesake = named_by(subject, seekers, first_names)
            firsts = [s.name for s, first in named if first]
            if firsts:
                if any(by_first[name] < per_person for name in firsts):
                    by_first.update(firsts)
                    opened.add(i)
            elif not council[k]:
                continue
            elif named:
                surname_only.append((i, [s for s, _ in named]))
            elif not namesake and not names_somebody(subject) and unnamed[k] < UNNAMED:
                unnamed[k] += 1
                opened.add(i)
        by_surname: Counter[tuple[str, str]] = Counter()
        for i, who in surname_only:
            wanting = [
                s.name
                for s in who
                if not by_first[s.name] and by_surname[s.name] < per_person
            ]
            if wanting:
                by_surname.update(wanting)
                opened.add(i)
        links: dict[int, list[LinkContext]] = {k: [] for k in range(len(registers))}
        for i, (k, record) in enumerate(rows):
            if i not in opened:
                continue
            for z in self.files(client, str(record.get("id"))):
                links[k].append(
                    LinkContext(
                        f"{EURZAD}/{client}/server/pobierz_rejestry_zalacznik/{z['id']}",
                        str(z.get("nazwa") or ""),
                        str(record.get("temat") or ""),
                    )
                )
        return [
            Register(
                f"{EURZAD}/{client}/#!/rejestry/{quote(str(r.get('symbol')))}"
                "/10/1/default/_",
                str(r.get("nazwa") or ""),
                tuple(links[k]),
            )
            for k, r in enumerate(registers)
        ]


def _number(value: object) -> int:
    """A page count as the app writes it, 1 when it says nothing sensible."""
    try:
        return max(1, int(str(value)))
    except ValueError:
        return 1
