"""Postgres-backed URL queue (bip_queue) for the BIP crawler.

Tables `bip_hosts` / `bip_urls` / `bip_docs` / `bip_runs` are created once by
hand (DDL in `scrapers/bip/schema.sql`); this class never creates schema.

The coordinator is the only writer, so the API is deliberately coarse: claim a
batch of URLs, mark results, keep per-host counters and finalize hosts.
"""

from __future__ import annotations

import json
import random

from psycopg import sql

from scrapers.bip.types import DocRow, HostRow, RunStats, UrlRow
from scrapers.common.pg import PostgresClient

# Postgres btree rejects index entries over ~2704 bytes; urls.url is the primary
# key, so over-long URLs (tracking blobs, encoded payloads) are never real
# pages. Same guard as the article crawler's queue.
MAX_URL_BYTES = 2000


class BipQueue:
    def __init__(self, pg: PostgresClient) -> None:
        self.pg = pg

    # -- hosts ---------------------------------------------------------------
    def upsert_hosts(self, hosts: list[HostRow]) -> tuple[int, int]:
        """Insert new hosts, refresh names of known ones. (inserted, updated)."""
        rows = [(h.host, h.name, h.source_url, h.teryt, h.entry_count) for h in hosts]
        with self.pg.transaction() as cur:
            cur.execute(
                "SELECT host FROM bip_hosts WHERE host = ANY(%s)",
                ([r[0] for r in rows],),
            )
            existing = {r[0] for r in cur.fetchall()}
            cur.executemany(
                """
                INSERT INTO bip_hosts (host, name, source_url, teryt, entry_count)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (host) DO UPDATE
                   SET name = EXCLUDED.name,
                       source_url = EXCLUDED.source_url,
                       entry_count = EXCLUDED.entry_count,
                       teryt = COALESCE(NULLIF(EXCLUDED.teryt, ''), bip_hosts.teryt)
                """,
                rows,
            )
        inserted = sum(1 for r in rows if r[0] not in existing)
        return inserted, len(rows) - inserted

    def select_hosts(
        self, *, freshness_seconds: int | None, limit: int
    ) -> list[HostRow]:
        """Hosts to crawl: new, unfinished, or stale `ok` ones."""
        sql = """
            SELECT host, name, source_url, teryt, entry_count, status
              FROM bip_hosts
             WHERE status IN ('new', 'partial', 'active')
                OR (
                     status = 'ok'
                     AND %s::bigint IS NOT NULL
                     AND last_crawled
                         < now() - make_interval(secs => %s::double precision)
                   )
             ORDER BY last_crawled NULLS FIRST, host
             LIMIT %s
        """
        rows = self.pg.fetchall(
            sql, (freshness_seconds, freshness_seconds or 0, limit)
        )
        return [
            HostRow(
                host=r[0],
                name=r[1],
                source_url=r[2],
                teryt=r[3],
                entry_count=r[4],
                status=r[5],
            )
            for r in rows
        ]

    def start_host(self, host: str, crawl_id: str) -> None:
        """Activate a host for a new attempt.

        URLs skipped because of the previous attempt's caps go back to the
        queue: otherwise a resumed host fetches its seed, has nothing pending
        and is declared `ok` while thousands of its URLs are still unfetched.
        Robots-denied URLs stay skipped: a robots rejection is treated as
        permanent, so they must not eat the run's queue again.
        """
        with self.pg.transaction() as cur:
            cur.execute(
                """
                UPDATE bip_hosts
                   SET crawl_id = %s, status = 'active', pages_fetched = 0,
                       docs_fetched = 0, cap_hit = false
                 WHERE host = %s
                """,
                (crawl_id, host),
            )
            cur.execute(
                """
                UPDATE bip_urls
                   SET state = 'queued', locked_by = NULL, locked_until = NULL
                 WHERE host = %s AND state = 'skipped'
                   AND skip_reason IS DISTINCT FROM 'robots'
                """,
                (host,),
            )

    def bump_host(
        self, host: str, *, pages: int = 0, docs: int = 0, cap_hit: bool = False
    ) -> None:
        self.pg.execute(
            """
            UPDATE bip_hosts
               SET pages_fetched = pages_fetched + %s,
                   docs_fetched = docs_fetched + %s,
                   cap_hit = cap_hit OR %s
             WHERE host = %s
            """,
            (pages, docs, cap_hit, host),
        )

    def host_pending(self, host: str) -> int:
        row = self.pg.fetchone(
            """
            SELECT COUNT(*) FROM bip_urls
             WHERE host = %s AND state IN ('queued', 'claimed')
            """,
            (host,),
        )
        return int(row[0]) if row else 0

    def finalize_host(self, host: str, status: str) -> None:
        self.pg.execute(
            """
            UPDATE bip_hosts
               SET status = %s, last_crawled = now()
             WHERE host = %s
            """,
            (status, host),
        )

    # -- urls ----------------------------------------------------------------
    def queue_url(self, row: UrlRow, *, requeue: bool = False) -> bool:
        """Insert a URL as queued, or refresh an existing row.

        Returns True when the URL was newly inserted. `requeue=True` also puts a
        previously fetched/skipped URL back into the queue (freshness re-crawl),
        except robots-denied ones: those are never revived.
        """
        return self.queue_urls([row], requeue=requeue) > 0

    def queue_urls(self, rows: list[UrlRow], *, requeue: bool = False) -> int:
        """Queue a batch of URLs in one statement; returns newly inserted rows.

        Same semantics as `queue_url`, but one round trip per page instead of
        one per link. Duplicate URLs inside the batch collapse to one row.
        """
        unique: dict[str, UrlRow] = {}
        for row in rows:
            if len(row.url.encode("utf-8")) <= MAX_URL_BYTES:
                unique.setdefault(row.url, row)
        if not unique:
            return 0
        values = sql.SQL(", ").join(
            sql.SQL("(%s, %s, %s, %s, %s, %s, %s, 'queued')") for _ in unique
        )
        query = sql.SQL(
            """
            INSERT INTO bip_urls
                (url, host, kind, discovered_from, depth, section,
                 anchor_text, state)
            VALUES {values}
            ON CONFLICT (url) DO UPDATE
               SET last_seen = now(),
                   anchor_text = CASE
                                   WHEN bip_urls.anchor_text = ''
                                   THEN EXCLUDED.anchor_text
                                   ELSE bip_urls.anchor_text
                                 END,
                   state = CASE
                             WHEN bip_urls.state = 'skipped'
                                  AND bip_urls.skip_reason IS NOT DISTINCT
                                      FROM 'robots'
                               THEN bip_urls.state
                             WHEN {requeue} OR bip_urls.state = 'skipped'
                               THEN 'queued'
                             ELSE bip_urls.state
                           END,
                   locked_by = CASE
                                 WHEN bip_urls.state = 'skipped'
                                      AND bip_urls.skip_reason IS NOT DISTINCT
                                          FROM 'robots'
                                   THEN bip_urls.locked_by
                                 WHEN {requeue} OR bip_urls.state = 'skipped'
                                   THEN NULL
                                 ELSE bip_urls.locked_by
                               END,
                   locked_until = CASE
                                    WHEN bip_urls.state = 'skipped'
                                         AND bip_urls.skip_reason IS NOT DISTINCT
                                             FROM 'robots'
                                      THEN bip_urls.locked_until
                                    WHEN {requeue} OR bip_urls.state = 'skipped'
                                      THEN NULL
                                    ELSE bip_urls.locked_until
                                  END
            RETURNING (xmax = 0) AS inserted
            """
        ).format(values=values, requeue=sql.Literal(requeue))
        params = [
            value
            for row in unique.values()
            for value in (
                row.url,
                row.host,
                row.kind,
                row.discovered_from,
                row.depth,
                row.section,
                row.anchor_text[:500],
            )
        ]
        with self.pg.transaction() as cur:
            cur.execute(query, params)
            inserted = [r[0] for r in cur.fetchall()]
        return sum(1 for flag in inserted if flag)

    def claim_urls(
        self,
        worker_id: str,
        *,
        hosts: list[str],
        limit: int,
        lock_seconds: int,
    ) -> list[UrlRow]:
        """Claim up to `limit` URLs, weighted by each host's queued backlog.

        Every active host gets at least one URL per batch (from a shuffled host
        order, so no host starves), and hosts whose queue holds thousands of
        URLs get up to 16 slots, proportional to depth. Equal shares make a
        20k-page school archive take days while tiny hosts idle; weighting keeps
        all hosts progressing and lets deep archives finish in proportion to
        their size. Expired claims are only consulted when this comes up short.
        """
        if not hosts:
            return []
        counts = dict(
            self.pg.fetchall(
                """
                SELECT host, count(*) FROM bip_urls
                 WHERE host = ANY(%s) AND state = 'queued'
                 GROUP BY host
                """,
                (hosts,),
            )
        )
        weighted = [
            (host, max(1, min(16, counts.get(host, 0) // 1000)))
            for host in hosts
            if counts.get(host)
        ]
        if not weighted:
            return []
        random.shuffle(weighted)
        candidates = self.pg.fetchall(
            """
            SELECT q.url FROM unnest(%s::text[], %s::int[])
                WITH ORDINALITY AS h(host, weight, ord)
            CROSS JOIN LATERAL (
                SELECT url FROM bip_urls
                 WHERE host = h.host AND state = 'queued'
                 ORDER BY depth, first_seen
                 LIMIT h.weight
            ) q
            ORDER BY h.ord
            LIMIT %s
            """,
            (
                [host for host, _ in weighted],
                [weight for _, weight in weighted],
                limit,
            ),
        )
        if len(candidates) < limit:
            candidates += self.pg.fetchall(
                """
                SELECT url FROM bip_urls
                 WHERE host = ANY(%s) AND state = 'claimed'
                   AND locked_until < now()
                 ORDER BY depth, first_seen
                 LIMIT %s
                """,
                (hosts, limit - len(candidates)),
            )
        if not candidates:
            return []
        rows = self.pg.fetchall(
            """
            UPDATE bip_urls
               SET state = 'claimed',
                   locked_by = %s,
                   locked_until = now() + make_interval(secs => %s),
                   attempts = attempts + 1
             WHERE url = ANY(%s)
               AND (state = 'queued'
                    OR (state = 'claimed' AND locked_until < now()))
            RETURNING url, host, kind, discovered_from, depth, section
            """,
            (worker_id, lock_seconds, [r[0] for r in candidates]),
        )
        return [
            UrlRow(
                url=r[0],
                host=r[1],
                kind=r[2],
                discovered_from=r[3],
                depth=r[4],
                section=r[5],
            )
            for r in rows
        ]

    def mark_url(
        self,
        url: str,
        *,
        state: str,
        status: int = 0,
        content_type: str = "",
        size: int = 0,
        sha256: str = "",
        title: str = "",
        skip_reason: str = "",
    ) -> None:
        self.pg.execute(
            """
            UPDATE bip_urls
               SET state = %s, last_status = %s, last_checked = now(),
                   last_seen = now(),
                   skip_reason = NULLIF(%s, ''),
                   content_type = COALESCE(NULLIF(%s, ''), content_type),
                   size = %s,
                   sha256 = COALESCE(NULLIF(%s, ''), sha256),
                   title = COALESCE(NULLIF(%s, ''), title)
             WHERE url = %s
            """,
            (state, status, skip_reason, content_type, size, sha256, title, url),
        )

    # -- documents -----------------------------------------------------------
    def record_docs(self, docs: list[DocRow], crawl_id: str) -> int:
        """Insert documents, ignoring duplicates by sha256. Returns new count."""
        if not docs:
            return 0
        new = 0
        with self.pg.transaction() as cur:
            for row in docs:
                cur.execute(
                    """
                    INSERT INTO bip_docs
                        (sha256, url, host, content_type, size, filename, title,
                         bundle, chain, crawl_id)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (sha256) DO UPDATE
                       SET bundle = EXCLUDED.bundle,
                           url = EXCLUDED.url,
                           last_seen = now()
                    RETURNING (xmax = 0) AS inserted
                    """,
                    (
                        row.sha256,
                        row.url,
                        row.host,
                        row.content_type,
                        row.size,
                        row.filename,
                        row.title,
                        row.bundle,
                        json.dumps(row.chain),
                        crawl_id,
                    ),
                )
                result = cur.fetchone()
                if result and result[0]:
                    new += 1
        return new

    def docs_for_bundle(self, bundle: str) -> list[tuple[str, str]]:
        """(sha256, filename) for every document recorded in a bundle."""
        return [
            (r[0], r[1])
            for r in self.pg.fetchall(
                "SELECT sha256, filename FROM bip_docs WHERE bundle = %s", (bundle,)
            )
        ]

    def delete_docs(self, shas: list[str]) -> int:
        if not shas:
            return 0
        with self.pg.transaction() as cur:
            cur.execute("DELETE FROM bip_docs WHERE sha256 = ANY(%s)", (shas,))
            return int(cur.rowcount)

    def doc_bundle(self, sha256: str) -> str | None:
        row = self.pg.fetchone(
            "SELECT bundle FROM bip_docs WHERE sha256 = %s", (sha256,)
        )
        return str(row[0]) if row else None

    # -- runs / stats --------------------------------------------------------
    def start_run(self, run_id: str) -> None:
        self.pg.execute(
            "INSERT INTO bip_runs (run_id) VALUES (%s) ON CONFLICT DO NOTHING",
            (run_id,),
        )

    def finish_run(self, run_id: str, stats: RunStats) -> None:
        self.pg.execute(
            """
            UPDATE bip_runs
               SET finished = now(), hosts_done = %s, pages = %s, docs_new = %s,
                   docs_seen = %s, errors = %s
             WHERE run_id = %s
            """,
            (
                stats.hosts_finalized,
                stats.pages_fetched,
                stats.docs_new,
                stats.docs_seen,
                stats.errors,
                run_id,
            ),
        )

    def recent_rates(self, window_minutes: int = 60) -> dict[str, float]:
        """Moving per-window throughput: pages, docs, hosts and bytes."""
        row = self.pg.fetchone(
            """
            SELECT
              (SELECT COUNT(*) FROM bip_urls
                WHERE kind = 'page'
                  AND last_checked > now() - make_interval(mins => %s)),
              (SELECT COUNT(*) FROM bip_docs
                WHERE first_seen > now() - make_interval(mins => %s)),
              (SELECT COUNT(*) FROM bip_hosts
                WHERE last_crawled > now() - make_interval(mins => %s)),
              (SELECT COUNT(DISTINCT host) FROM bip_urls
                WHERE last_checked > now() - make_interval(mins => %s)),
              (SELECT COALESCE(SUM(size), 0) FROM bip_docs
                WHERE first_seen > now() - make_interval(mins => %s))
            """,
            (window_minutes,) * 5,
        )
        pages, docs, hosts, doc_hosts, size = row or (0, 0, 0, 0, 0)
        minutes = max(window_minutes, 1)
        return {
            "window_minutes": window_minutes,
            "pages": int(pages),
            "docs": int(docs),
            "hosts": int(hosts),
            "doc_hosts": int(doc_hosts),
            "bytes": int(size),
            "pages_per_min": round(pages / minutes, 1),
            "docs_per_min": round(docs / minutes, 1),
            "hosts_per_min": round(hosts / minutes, 2),
        }

    def stats(self) -> dict[str, object]:
        row = self.pg.fetchone(
            """
            SELECT
              (SELECT COUNT(*) FROM bip_hosts),
              (SELECT COUNT(*) FROM bip_hosts WHERE status = 'new'),
              (SELECT COUNT(*) FROM bip_hosts WHERE status = 'active'),
              (SELECT COUNT(*) FROM bip_hosts WHERE status = 'ok'),
              (SELECT COUNT(*) FROM bip_hosts WHERE status = 'partial'),
              (SELECT COUNT(*) FROM bip_hosts WHERE status = 'dead'),
              (SELECT COUNT(*) FROM bip_urls WHERE state = 'queued'),
              (SELECT COUNT(*) FROM bip_urls WHERE state = 'claimed'),
              (SELECT COUNT(*) FROM bip_docs),
              (SELECT COALESCE(SUM(size), 0) FROM bip_docs)
            """
        )
        keys = [
            "hosts",
            "hosts_new",
            "hosts_active",
            "hosts_ok",
            "hosts_partial",
            "hosts_dead",
            "urls_queued",
            "urls_claimed",
            "docs",
            "doc_bytes",
        ]
        return dict(zip(keys, row)) if row else {}
