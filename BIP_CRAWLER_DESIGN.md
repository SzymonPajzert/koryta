# BIP crawler — design (iteration 2: Postgres queue, coordinator + fetchers)

Status: revised 2026-09-19 after review feedback. Supersedes the SQLite/host-shard
design of iteration 1. Recon evidence lives in `BIP_SCRAPING_80_20.md`.

## 1. Goal

Crawl every BIP site in the official gov.pl registry and harvest every public
document (PDF / office / zip) with provenance and per-URL freshness, so reruns
are incremental and a host is only marked done when it was fully explored.

## 2. Non-goals

- OCR / text extraction / parsing (later iteration).
- Vendor adapters (Netkoncept `/xml`, SharePoint OData, Liferay JSON) — later.
- GCS upload (local output for now; swap point is `ctx.io.batch_upload`).

## 3. Recon facts that shape the design

(Full evidence in `BIP_SCRAPING_80_20.md`; only what constrains the crawler.)

- **Registry**: `https://www.gov.pl/web/bip/spis` → ZIP → `subjects.xml`;
  13.3k rows → 9,707 unique hosts; fields include `name`, `url`, `communeTercCode`.
- **Sitemaps**: only ~17% of hosts expose one; median 55 URLs, mean 1,037, max ~12k.
- **Document URL patterns** (classifier seed): `/attachments/download/<id>`,
  `/api/files/<id>`, `/fobjects/download/…`, `/plik,<id>,<slug>.pdf`, `getFile?id=`,
  `plik.php?zid=`, `dokument.php?iddok=`, `/res/serwisy/pliki/`, `/resource/…`,
  `/upload/pliki/…`, `/system/obj/…`.
- **HTML is not the data**: declaration/contract values are in the linked files;
  pages carry metadata and links. Structured feeds exist on ~1–4% of hosts.
- **Churn**: ~30% of registry URLs are dead or 403-blocked; ~30% of hosts yield
  documents. Capacities measured on the first full pass: 9.7k hosts → 235k docs,
  ~200 GB, ~70% PDFs.

## 4. Architecture

```
gov.pl ZIP ─► stores/bip_registry.py ─► registry.py ─► bip_hosts (Postgres)

coordinator (one process, owns Postgres + quota state + bundle writes)
  ├─ claim_urls(): SELECT … FROM bip_urls WHERE state='queued' ORDER BY priority, id
  │                FOR UPDATE SKIP LOCKED → UPDATE state='claimed', locked_until=…
  ├─ quota gate: skip URLs whose host exhausted pages/docs budget
  ├─ fetch_q ──► fetcher threads (8–12): curl_cffi fetch, classify, extract links
  │                  ▲                    │
  │                  └──── results ───────┘
  └─ on result: upsert bip_urls (last_checked/state), store document,
                append to host bundle, enqueue discovered URLs, update quotas
```

- **No host sharding.** Work is URL-level; many URLs of the same host are in
  flight at once (throttled), other hosts interleave naturally.
- **One writer.** Fetchers do HTTP + parsing only; the coordinator writes DB rows
  and bundles, so there are no cross-thread writes and no file locks.
- **Single process + threads** (like the article crawler). Multiple coordinator
  processes are possible later because claims are safe; only the per-host rate
  limit would then need sharing (see §8).

## 5. Postgres schema (one-time manual setup)

DB: the same Postgres the article crawler uses (`POSTGRES_*` in `.env`).
Run this **once by hand** (`psql`); the crawler never creates or migrates schema.
`sqlite` is gone from the codebase.

```sql
CREATE TABLE bip_hosts (
  host          text PRIMARY KEY,
  name          text NOT NULL DEFAULT '',
  source_url    text NOT NULL DEFAULT '',
  teryt         text NOT NULL DEFAULT '',
  entry_count   int  NOT NULL DEFAULT 1,
  platform      text NOT NULL DEFAULT 'unknown',
  status        text NOT NULL DEFAULT 'new',   -- new|active|ok|partial|dead
  pages_fetched int  NOT NULL DEFAULT 0,       -- current attempt
  docs_fetched  int  NOT NULL DEFAULT 0,
  pending_urls  int  NOT NULL DEFAULT 0,       -- claimable or in flight
  cap_hit       bool NOT NULL DEFAULT false,
  crawl_id      text NOT NULL DEFAULT '',      -- current attempt id
  first_seen    timestamptz NOT NULL DEFAULT now(),
  last_crawled  timestamptz
);

CREATE TABLE bip_urls (
  url            text PRIMARY KEY,
  host           text NOT NULL,
  kind           text NOT NULL DEFAULT 'page',  -- page|doc
  discovered_from text NOT NULL DEFAULT '',
  depth          int  NOT NULL DEFAULT 0,
  section        text NOT NULL DEFAULT '',
  priority       int  NOT NULL DEFAULT 50,      -- lower = sooner
  content_type   text NOT NULL DEFAULT '',
  size           bigint NOT NULL DEFAULT 0,
  sha256         text NOT NULL DEFAULT '',
  title          text NOT NULL DEFAULT '',
  last_status    int  NOT NULL DEFAULT 0,
  state          text NOT NULL DEFAULT 'queued', -- queued|claimed|fetched|error|skipped
  attempts       int  NOT NULL DEFAULT 0,
  locked_by      text,
  locked_until   timestamptz,
  first_seen     timestamptz NOT NULL DEFAULT now(),
  last_checked   timestamptz,
  last_seen      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bip_urls_claim_idx ON bip_urls (state, priority, first_seen);
CREATE INDEX bip_urls_host_idx  ON bip_urls (host, state);

CREATE TABLE bip_docs (
  sha256       text PRIMARY KEY,
  url          text NOT NULL,
  host         text NOT NULL,
  kind         text NOT NULL DEFAULT 'pdf',
  content_type text NOT NULL DEFAULT '',
  size         bigint NOT NULL DEFAULT 0,
  filename     text NOT NULL DEFAULT '',
  title        text NOT NULL DEFAULT '',
  bundle       text NOT NULL DEFAULT '',
  chain        jsonb NOT NULL DEFAULT '[]',
  crawl_id     text NOT NULL DEFAULT '',
  first_seen   timestamptz NOT NULL DEFAULT now(),
  last_seen    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bip_docs_host_idx ON bip_docs (host);

CREATE TABLE bip_runs (
  run_id   text PRIMARY KEY,
  started  timestamptz NOT NULL DEFAULT now(),
  finished timestamptz,
  hosts_done int NOT NULL DEFAULT 0,
  pages      int NOT NULL DEFAULT 0,
  docs_new   int NOT NULL DEFAULT 0,
  docs_seen  int NOT NULL DEFAULT 0,
  errors     int NOT NULL DEFAULT 0
);
```

## 6. URL lifecycle

```
insert (discovered)   → state='queued', first_seen=now(), last_seen=now()
claim                 → state='claimed', locked_by, locked_until=now()+10min, attempts+1
fetch ok              → state='fetched', last_checked=now(), last_seen=now()
fetch error           → state='error' (after attempts exhausted) or back to 'queued'
quota / out of scope  → state='skipped'
re-encountered later  → UPDATE last_seen=now(); NEVER a second row
claim expired         → back to 'queued' (another coordinator or the next run picks it up)
```

## 7. Coordinator: quotas, completion, status

- **Quotas are per host per attempt**, owned by the coordinator in memory
  (loaded from `bip_hosts.pages_fetched/docs_fetched` at start): default
  150 pages / 500 docs, deep pass 400 / 1500.
- A URL whose host is over budget is marked `skipped`; `bip_hosts.cap_hit=true`.
- **`pending_urls`** counts `queued + claimed` for the host. When it drops to 0
  and no fetch is in flight:
  - `status='ok'` **only** if `cap_hit=false` and no errors → host fully explored;
  - otherwise `status='partial'`;
  - `status='dead'` if no page was ever fetched successfully.
- **Freshness (`--freshness 7d`)**: selection is
  `status='new' OR status='partial' OR (status='ok' AND last_crawled < now()-freshness)`.
  Selected hosts get a new `crawl_id`, counters reset, and their `page` URLs
  re-queued (documents are immutable: sha256 dedup means re-fetching a document
  is cheap to skip; documents whose bundle is missing are re-stored).

## 8. Politeness, robots, rate limit

- Reuse the article crawler's machinery instead of copying it:
  - **Robots**: `stores/web.py` robot logic, extended for `Crawl-delay` and
    `http://` hosts, cached per host.
  - **Token bucket**: the article crawler's per-host limiter, extracted to a
    shared util; one bucket per fetching process (agreed: same semantics as the
    article crawler).
  - **Fetch**: a small shared wrapper around `curl_cffi` (`impersonate`,
    timeout, retries, UA).
- Robot rules are evaluated per URL; `Disallow` → `state='skipped'`.

## 9. Storage

- **Local by default**: `--out DIR`; bundle layout
  `hostname=<host>/crawl=<crawl_id>/uid_<id>.tar.gz` + `index.txt`.
  One bundle per host+crawl gives isolation between attempts and keeps parallel
  re-crawls from mixing.
- The coordinator is the only bundle writer; fetchers hand over bytes.
- Bundles are **not** appendable after an interrupted process; a killed crawl
  leaves `.part` files that are recovered by re-crawling (docs dedup by sha).
- Later: same interface backed by `ctx.io.batch_upload` (tar.gz per host+date) so
  output lands in GCS without touching crawler logic.

## 10. Shared utils to extract (no duplication)

| Piece | Current home | Action |
|---|---|---|
| robots.txt fetch/parse + Crawl-delay | `stores/web.py` (`WebImpl`) | extend; import from both crawlers |
| token-bucket rate limiter | `scrapers/article/crawler.py` (private) | promote to a shared module |
| link extraction | `scrapers/article/crawler.py` | shared version with `keep_query=True` flag (article strips queries, BIP needs them) |
| fetch wrapper (curl_cffi) | `article/crawler.py` + `bip_cli.py` | shared util |
| bundle/batch upload | `stores/storage.py` (`BatchClient.batch_upload`) | reuse for the GCS backend later |

## 11. CLI

```
koryta_scrape_bip registry [--db DSN]
koryta_scrape_bip crawl    --out DIR --workers N --freshness 7d [--hosts N]
                           [--max-pages N] [--max-docs N] [--depth N] [--rate S]
koryta_scrape_bip stats
```

- `--workers`: fetcher threads (default 8, capped ~12).
- `--freshness`: host selection window (see §7).
- `--out`: local bundle directory (default `bip_crawl_out`, soon the default
  Postgres-backed GCS path).
- Progress on screen every ~30 s: hosts done/remaining, URLs queued/claimed/
  fetched, docs stored (new/seen), bytes, errors, current rate — same shape as
  `koryta_crawl` logs.

## 12. Migration of the existing corpus (one-time, manual)

The iteration-1 corpus (9,707 hosts, 235k docs, ~200 GB on
`/mnt/disk/koryta/bip`) must be imported into Postgres once:

1. Run the DDL from §5 by hand.
2. One-off script (kept outside the package, `tools/sqlite_to_pg.py`):
   `frontier.db` → `bip_hosts` / `bip_urls` / `bip_docs` (URLs states mapped:
   `seen→fetched`, `error→error`, `new→queued`).
3. Delete `frontier.py` and every SQLite reference from the package.

## 13. Milestones & acceptance

| # | Deliverable | Acceptance |
|---|---|---|
| M1 | Postgres schema + registry ingest | 13.3k rows → 9,707 `bip_hosts`; no sqlite in the tree |
| M2 | URL queue + coordinator + fetchers | one host fully explored end-to-end; quotas and `pending_urls` reconcile |
| M3 | Shared utils extraction (robots, bucket, links, fetch) | article crawler still passes its tests using the shared code |
| M4 | Freshness + resume | rerun selects only `new`/stale/`partial`; second pass does not duplicate URL rows |
| M5 | Full run | every host `ok`/`partial`/`dead`; `ok` implies no cap hit and no errors |

## 14. Risks / open questions

- **Coordinator throughput**: single writer could become the bottleneck once
  fetchers return large documents; mitigate by batching DB writes (the article
  crawler flushes in batches) and by keeping document bytes on the fetcher until
  the coordinator requests them if memory becomes an issue.
- **Claim expiry vs long documents**: 10 min may be too short for a 60 MB file on
  a slow host; either raise `locked_until` per attempt or renew on progress.
- **`pending_urls` drift**: must be updated in the same transaction as the URL
  state change; a periodic reconciliation query can repair it.
- **Rate limit with multiple coordinators**: per-process buckets multiply the
  per-host rate; if we ever run several coordinators, move the bucket to
  Postgres (`next_allowed_at` per host).

## 15. As-built history (iteration 1, for context)

- Registry: 13,306 rows → 9,707 hosts.
- Full pass: 9,707/9,707 hosts attempted; 234,959 docs (~200 GB, ~70% PDFs);
  5,400+ bundles; 3,055 dead (stale/blocked), 1,785 partial.
- Two production bugs found and fixed: bundles not finalized per host, and
  cap-truncated hosts marked `ok` (both with regression tests).
- Iteration-1 code lives in `scrapers/bip/` (frontier SQLite, LocalBundleStore,
  thread pool per host); iteration 2 replaces the frontier and the work model,
  keeping `registry.py`, `classify.py`, `models.py` and the tests' intent.
