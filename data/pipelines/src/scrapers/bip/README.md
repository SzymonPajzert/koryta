# BIP crawler

Harvests documents from the official gov.pl BIP registry (~9.7k hosts) into
local `tar.gz` bundles. Pure crawler: it stores files, it does not parse them
(the `BipUrlsClassified` / `BipDocumentsParsed` pipelines do that).

## Setup

Tables are created once, by hand:

```bash
psql "$DATABASE_URL" -f src/scrapers/bip/schema.sql
```

The Postgres connection comes from the same env vars as the article crawler
(`POSTGRES_HOST`, `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`,
`POSTGRES_PORT`).

Run it as the installed script:

```bash
koryta_scrape_bip <command> [options]
```

## Commands

### `registry`

Download the gov.pl BIP registry ZIP and upsert its hosts.

```bash
koryta_scrape_bip registry [--xml-cache PATH] [--refresh]
```

`crawl` runs this automatically when `bip_hosts` is empty, so a fresh database
only needs `crawl`. Use `registry` (with `--refresh`) to pick up changes to the
official list.

- `--xml-cache` (default `bip_crawl_out/registry/subjects.xml`) — the unpacked
  XML is cached here; without `--refresh` the cache is reused.
- Dedupes rows by host, keeps the root-path entry as the host's name/seed, and
  refreshes `source_url` on re-ingest.

### `crawl`

Claim URLs from the queue and harvest documents, host by host.

```bash
koryta_scrape_bip crawl \
  [--out PATH] [--workers N] [--max-active-hosts N] [--hosts N] \
  [--freshness 7d|12h] [--max-pages N] [--max-docs N] [--depth N] \
  [--rate SECONDS] [--no-repair] [--repair-older-than MINUTES]
```

- `--out` (default `bip_crawl_out`) — bundle tree.
- `--xml-cache` / `--refresh-registry` / `--no-registry` — control the
  automatic registry ingest when `bip_hosts` is empty.
- `--workers` — concurrent fetchers (default 8).
- `--max-active-hosts` — hosts in flight at once (default 50).
- `--hosts` — cap hosts this run; `--freshness` — re-crawl `ok` hosts older
  than this (e.g. `7d`, `12h`).
- `--max-pages` / `--max-docs` — per-host caps; a capped host is marked
  `partial`, so a later pass picks it up again.
- `--rate` — seconds between hits on one host (default 1.0).
- On start it re-wraps every stale `.part` bundle left by a killed run
  (`--no-repair` to skip); a single crawler per `--out` is assumed.

Politeness: robots.txt is fetched per host (404 = allow). The crawl is
BFS-ordered (by depth); a seed that redirects to another host is followed
there once, after which only links on that host are kept.

### `repair`

Recover `.part` bundles from a killed run without re-downloading: re-wrap the
truncated `tar.gz` under its final name and prune `bip_docs` rows whose member
did not survive.

```bash
koryta_scrape_bip repair [--out PATH] [--older-than-minutes N] [--keep-missing]
```

`--older-than-minutes` (default 10) leaves bundles a live crawl may still be
writing untouched. `crawl` runs this automatically at startup.

### `stats`

Print queue counters and the last-hour throughput.

```bash
koryta_scrape_bip stats
```

## Storage layout

```
bip_crawl_out/
  hostname=<host>/crawl=<crawl_id>/uid_<n>.tar.gz   # documents + index.txt
```

Each bundle holds the fetched files plus `index.txt` listing members. Each
document is deduplicated by `sha256`, so the same file reached from several
URLs is stored once. `bip_urls.discovered_from` and `bip_docs.chain` record the
link that led to each URL/document.

A run that is killed without a chance to flush (SIGKILL/power loss) leaves
`.part` bundles; graceful SIGINT/SIGTERM flushes and closes them.
