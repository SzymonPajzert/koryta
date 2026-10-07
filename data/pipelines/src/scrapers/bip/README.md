# BIP crawler

Harvests documents from the official gov.pl BIP registry (~9.7k hosts) into
local `tar.gz` bundles. Pure crawler: it stores files, it does not parse them
(the `BipUrlsClassified` / `BipDocumentsParsed` pipelines do that).

## Setup

The `bip_*` tables are created automatically on the first run; no manual
`schema.sql` step. The Postgres connection comes from the same env vars as the
article crawler (`POSTGRES_HOST`, `POSTGRES_DB`, `POSTGRES_USER`,
`POSTGRES_PASSWORD`, `POSTGRES_PORT`).

Run it as the installed script:

```bash
koryta_scrape_bip <command> [options]
```

## Commands

### `crawl`

On an empty `bip_hosts` it first ingests the gov.pl registry, then claims URLs
and harvests documents host by host.

```bash
koryta_scrape_bip crawl \
  [--out PATH] [--workers N] [--max-active-hosts N] [--hosts N] \
  [--freshness 7d|12h] [--max-pages N] [--max-docs N] [--depth N] \
  [--rate SECONDS] [--no-repair] [--no-registry] [--refresh-registry] \
  [--xml-cache PATH]
```

- `--out` (default `bip_crawl_out`) — bundle tree.
- `--workers` — concurrent fetchers (default 8).
- `--max-active-hosts` — hosts in flight at once (default 50).
- `--hosts` — cap hosts this run.
- `--freshness` — re-crawl `ok` hosts older than this (e.g. `7d`, `12h`).
- `--max-pages` / `--max-docs` — per-host caps; a capped host is marked
  `partial`, so a later pass picks it up again.
- `--depth` — link depth from each seed (default 4).
- `--rate` — seconds between hits on one host (default 1.0).
- Registry bootstrap: runs automatically when `bip_hosts` is empty; the XML is
  cached (`--xml-cache`), reused unless `--refresh-registry`, and can be skipped
  with `--no-registry`.
- On start it re-wraps every stale `.part` bundle left by a killed run
  (`--no-repair` to skip); a single crawler per `--out` is assumed.

Politeness: robots.txt is fetched per host (404 = allow; an error status or an
unreachable host denies). The crawl is BFS-ordered (by depth); a seed that
redirects to another host is followed there once, after which only links on that
host are kept.

### `repair`

Recover `.part` bundles from a killed run without re-downloading: re-wrap the
truncated `tar.gz` under its final name and prune `bip_docs` rows whose member
did not survive. `crawl` runs this automatically at startup; the command is for
running it by hand.

```bash
koryta_scrape_bip repair [--out PATH] [--older-than-minutes N] [--keep-missing]
```

`--older-than-minutes` (default 10) leaves bundles a live crawl may still be
writing untouched.

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

A run killed without a chance to flush (SIGKILL/power loss) leaves `.part`
bundles; graceful SIGINT/SIGTERM flushes and closes them. Stale `.part` bundles
are re-wrapped automatically on the next `crawl` start (or by `repair`).
