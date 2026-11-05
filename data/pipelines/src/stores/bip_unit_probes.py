"""How each BIP unit's start addresses answered, asked as the crawler and as a
browser (`jobs.bip_crawler.state`).

One table beside the people mode's (`stores.bip_people`), created on first use
like theirs: ``bip_unit_probes``, a row per unit and start address, the newest
probe only. A walk that ends unreachable or refused says nothing of why; the
probe's answers do ("no answer" from both agents is a host keeping predator
out, a 403 to the crawler and a 200 to a browser is a filter on its name).
"""

from __future__ import annotations

from abc import ABCMeta, abstractmethod
from dataclasses import dataclass
from datetime import datetime, timezone

from scrapers.common.pg import PostgresClient

_SCHEMA = """
CREATE TABLE IF NOT EXISTS bip_unit_probes (
  unit       text NOT NULL,
  url        text NOT NULL,
  crawler    text NOT NULL,
  browser    text NOT NULL,
  shell      bool NOT NULL DEFAULT false,
  checked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (unit, url)
)
"""


@dataclass(frozen=True)
class StartProbe:
    """How one start address answered: each agent's answer as its HTTP status
    ("403"), "robots" when robots.txt keeps the crawler out, or "no answer: "
    and why; ``shell`` when the page that came back is drawn by a script and
    links next to nothing (Gdynia's BIP)."""

    url: str
    crawler: str
    browser: str
    shell: bool = False
    checked_at: datetime | None = None


class UnitProbeStore(metaclass=ABCMeta):
    @abstractmethod
    def record(self, unit: str, probes: list[StartProbe]) -> None:
        """Replace ``unit``'s probes with these."""

    @abstractmethod
    def probes(self) -> dict[str, list[StartProbe]]:
        """Every unit's newest probes."""


class PostgresUnitProbeStore(UnitProbeStore):
    def __init__(self, pg: PostgresClient) -> None:
        self.pg = pg
        self.pg.execute(_SCHEMA)

    def record(self, unit: str, probes: list[StartProbe]) -> None:
        self.pg.execute("DELETE FROM bip_unit_probes WHERE unit = %s", (unit,))
        for p in probes:
            self.pg.execute(
                """
                INSERT INTO bip_unit_probes (unit, url, crawler, browser, shell)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (unit, url) DO UPDATE
                   SET crawler = EXCLUDED.crawler, browser = EXCLUDED.browser,
                       shell = EXCLUDED.shell, checked_at = now()
                """,
                (unit, p.url, p.crawler, p.browser, p.shell),
            )

    def probes(self) -> dict[str, list[StartProbe]]:
        out: dict[str, list[StartProbe]] = {}
        for unit, url, crawler, browser, shell, checked_at in self.pg.fetchall(
            "SELECT unit, url, crawler, browser, shell, checked_at"
            " FROM bip_unit_probes ORDER BY unit, url"
        ):
            out.setdefault(unit, []).append(
                StartProbe(url, crawler, browser, bool(shell), checked_at)
            )
        return out


class MemoryUnitProbeStore(UnitProbeStore):
    """The same in memory, for tests."""

    def __init__(self) -> None:
        self.rows: dict[str, list[StartProbe]] = {}

    def record(self, unit: str, probes: list[StartProbe]) -> None:
        now = datetime.now(timezone.utc)
        self.rows[unit] = [
            StartProbe(p.url, p.crawler, p.browser, p.shell, now) for p in probes
        ]

    def probes(self) -> dict[str, list[StartProbe]]:
        return dict(self.rows)
