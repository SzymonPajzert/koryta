# BIP crawler job

`jobs/bip_crawler` harvests documents from the official gov.pl BIP registry
(~9.7k hosts) into local `tar.gz` bundles. Pure crawler: it stores files, it
does not parse them (the `BipUrlsClassified` / `BipDocumentsParsed` pipelines do
that).

## Setup

The `bip_*` tables are created automatically on the first run; no manual
`schema.sql` step. The Postgres connection comes from the same env vars as the
article crawler (`POSTGRES_HOST`, `POSTGRES_DB`, `POSTGRES_USER`,
`POSTGRES_PASSWORD`, `POSTGRES_PORT`).

Run it as the installed script, or as a module:

```bash
koryta_scrape_bip <command> [options]
python -m jobs.bip_crawler <command> [options]
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
- `--max-minutes` — stop gracefully after this many minutes; exits 75 when work
  remains (useful when a caller gives the crawl a budget).
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

### `crawl --people-of-interest`

Instead of the blind crawl, looks up the oświadczenia majątkowe of the people in
`BipPeopleOfInterest` (one row per won local candidacy since 2014, read as the
KRS jobs read `ScrapeRejestrIO`), unit by unit. Meant for predator, by hand, not
the nightly: it is a long one-off with its own CPU budget.

```bash
koryta BipPeopleOfInterest                 # build or refresh the list first (optional)
koryta_scrape_bip crawl --people-of-interest --poi-max-priority 1 --max-minutes 120
koryta_scrape_bip crawl --people-of-interest              # everyone still pending
```

- Where a unit's search starts (`scrapers/bip/units.py`): the office's BIP from
  the gov.pl registry, else the office's website from the dane.gov.pl catalogue
  of public bodies and the "BIP" link on it. The registry has an office for only
  905 of 2,479 gminas; with the catalogue 2,335 of the 2,418 units on the 10-29
  list have a start.
- Each unit gets `--unit-pages` (150) pages, walked best first towards
  "oświadczenia majątkowe" (`scrapers/bip/people.py`), and stays under its own
  path on shared platforms (bip.malopolska.pl, samorzad.gov.pl).
- A link counts for a person when it names them: its label or address first,
  then its table row or list item, then the heading over it, then the page's
  title (`scrapers/bip/people.py` `candidates`); a narrower part that names
  somebody else ends the search. Names match as stems with Polish endings
  ("Nowaka" is Nowak, "Nowakowski" is not); when some of a person's links carry
  the first name too, only those count. Pages are read in the charset they
  declare. At most `--per-person` (3) files are downloaded per candidacy, into
  the same bundles and `bip_docs` as the blind crawl's; a file the walk reached
  through a link it took for a page is not fetched twice.
- A declarations page's files that name nobody (one file for the whole council)
  go to the people nothing named, at most three, when they say "majątkowe" and
  are not blank forms.
- Every candidacy ends the run `found` (a file a link names them in came down),
  `unconfirmed` (only files that name nobody came down: the OCR step has to
  find the person in them), or `not_found` with a reason: `no_seed`,
  `unreachable`, `robots`, `no_declarations`, `not_listed`, `download_failed`,
  `timeout`, `error`. Tables `bip_poi`, `bip_poi_docs` and `bip_units`
  (`stores/bip_people.py`) hold that. A later run searches the pending ones and
  the `--poi-retry` reasons (default `unreachable,error,timeout`; add
  `unconfirmed` or any other); `--poi-refresh` searches everybody. A search that
  finds nothing never undoes an earlier find or an earlier downloaded file.
- The run ends with this run's outcomes, every candidacy's, and both per election
  year: 2014-only candidacies are past BIP's six years more often than not, and the
  per-year counts are where that shows.
- `--poi-max-priority`: 0 draft pages without a birth date, 1 drafts with one,
  2 people not on the site yet, 3 published pages (verified already, so last). `--poi-limit` caps the
  candidacies, `--max-minutes` the run (walks stop at it, units not started stay
  pending; exit 75), `--workers` the units searched at once, `--rate` the seconds
  between hits on one host.
- One crawler per `--out`: the startup repair re-wraps every `.part` bundle
  there, so a second run on the same directory refuses to start
  (`.crawl.lock`).

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
