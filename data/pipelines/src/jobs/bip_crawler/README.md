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
koryta_scrape_bip crawl --people-of-interest --poi-max-priority 1 --max-minutes 120
koryta_scrape_bip crawl --people-of-interest              # everyone still pending
```

- The list is read as it is on disk, else as the night left it in the shared
  cache, and built from its inputs only when neither has it. A list on disk is
  never rebuilt, nor PeopleMerged under it (`PINNED` in `people.py`); to take
  the night's newer one, delete `versioned/bip_people_of_interest` first.
- Where a unit's search starts (`scrapers/bip/units.py`): the office's BIP from
  the gov.pl registry, else the office's website from the dane.gov.pl catalogue
  of public bodies and the "BIP" link on it. The registry has an office for only
  905 of 2,479 gminas; with the catalogue 2,335 of the 2,418 units on the 10-29
  list have a start.
- `unit_starts.csv` holds checked BIP addresses for units whose start is
  missing or dead in both lists; a row's declarations page and BIP replace
  what the lists had.
- Each unit's walk reads `--pages-per-candidacy` (15) pages for each of its
  candidacies, at least `--unit-pages` (150) and at most `--max-unit-pages`
  (1000), best first towards "oświadczenia majątkowe" and the seekers' own
  council or office (`scrapers/bip/people.py` `link_score`, `office_terms`), and
  stays under its own path on shared platforms (bip.malopolska.pl,
  samorzad.gov.pl). A big BIP files thousands of declarations beside the
  council's: with 150 pages bip.warszawa.pl gave none of 96 councillors.
- Before walking, the declaration URLs already known for the unit's hosts seed
  it: the BIP's sitemaps (robots.txt `Sitemap:`, else `/sitemap.xml`;
  `--no-sitemaps` skips them) and `--known-urls`, newline-delimited JSON rows
  with a `url` (and a `category`), such as the blind crawl's
  `BipUrlsClassified`. Their pages go first; their files count when the address
  names a seeker.
- Madkom's BIPs (bip.malopolska.pl's offices, and single-office hosts on its
  React app: bip.gminaolawa.pl, *.nv.pl) are read through the JSON API their
  pages are drawn from (`madkom.py`): the office's menu, a section's articles,
  an article and its files, one or two calls a page and drawn as an HTML page
  the walk reads as any other. A host counts as Madkom's when its first page is
  the app's shell and the API answers for its office. Articles and files that
  robots.txt hides by the app's own addresses (`<office>,a,<id>,artykul.html`,
  `e,pobierz,get.html?id=<id>`) are left out, and an API robots.txt closes is
  not read around by rendering.
- Other pages a script draws (next to no links and a `<script>`) are rendered
  in headless Chromium, `--render-workers` (2) at once, pictures and styles
  skipped, one turn of the host's rate for every request a render makes there
  (`render.py`). Needs the `render` dependency group and its browser
  (`.venv/bin/playwright install chromium`); without it, or with `--no-render`,
  they are read as their HTML.
- robots.txt directives run together on one line (bip.malopolska.pl's 18,000
  Disallow lines sat on its User-agent line, so no parser applied them) are
  split onto their own lines before parsing (`stores/web.py` `robots_lines`).
- Certificates verify against curl's roots plus Mozilla's published
  intermediates (`stores/tls.py`, kept at `--ca-bundle`, rebuilt weekly), so a
  server that leaves its intermediate out still verifies, as in a browser.
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
  `timeout` (the run's time ran out), `budget` (the unit's own
  `--max-unit-minutes`, 30, ran out; not retried by default), `throttled` (the
  BIP kept answering 429 or 503, each page asked three times 30 s apart, and
  pages went unread), `refused` (the BIP answers the crawler with a refusal
  dressed as a page, such as SYSTEMDOBIP.PL's "Zbyt dużo jednoczesnych
  połączeń"; not retried by default), `error`. Tables `bip_poi`, `bip_poi_docs` and `bip_units`
  (`stores/bip_people.py`) hold that. A later run searches the pending ones and
  the `--poi-retry` reasons (default `unreachable,error,timeout,no_seed,throttled`; add
  `unconfirmed` or any other), with `--poi-retry-before` only those last searched
  before a time (the ones an older walk settled: `--poi-retry
  no_declarations,not_listed,robots --poi-retry-before 2026-10-30T05:43Z`);
  `--poi-refresh` searches everybody. A search that finds nothing never undoes
  an earlier find or an earlier downloaded file.
- The run ends with this run's outcomes, every candidacy's, and both per election
  year: 2014-only candidacies are past BIP's six years more often than not, and the
  per-year counts are where that shows.
- `--poi-max-priority`: 0 draft pages without a birth date, 1 drafts with one,
  2 people not on the site yet, 3 published pages (verified already, so last). `--poi-limit` caps the
  candidacies, `--max-minutes` the run (walks stop at it, units not started stay
  pending; exit 75), `--workers` the units searched at once (at most
  `--max-per-host`, 1, on one start host: they share its rate), `--rate` the
  seconds between hits on one host.
- One crawler per `--out`: the startup repair re-wraps every `.part` bundle
  there, so a second run on the same directory refuses to start
  (`.crawl.lock`).

### `found`

Write the candidacies the people mode found a declaration for (status found,
never unconfirmed) to the shared cache, as
`jobs/bip_crawler/found/date=<UTC day>/<UTC stamp>.jsonl.gz`: key, priority,
docs, koryta and rejestr.io ids, no name or birth date. The night's people step
reads the newest one for its declaration groups (`--priority-group
oswiadczenia-szkice:N`, `oswiadczenia-bez-strony:N`), so run it after a chunk,
before 04:30.

```bash
koryta_scrape_bip found --dry-run   # count; write nothing
koryta_scrape_bip found
```

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
