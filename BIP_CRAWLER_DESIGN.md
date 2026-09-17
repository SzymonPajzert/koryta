# BIP crawler — design (iteration 1: harvest documents)

Status: draft · untracked, not committed · worktree `/home/mp/Projects/koryta.wt/bip-scraping`
(branch `bip-scraping` @ `2d41b223`). Companion recon: `BIP_SCRAPING_80_20.md`.

## 1. Goal

An iterative crawler that walks all Polish BIP sites and harvests every public document
(PDF / office / zip) with provenance and last-seen state. Parsing, OCR and entity
resolution are explicitly out of scope for iteration 1.

Success = a complete, resumable, deduplicated document inventory per host, plus the blobs,
plus the URL chain that led to each blob.

## 2. Non-goals (iteration 2+)

- OCR / text extraction / table parsing.
- Normalising structured feeds (store them as-is, parse later).
- Entity resolution / company-ownership edges.
- Full-text search.

## 3. Recon facts that shape the design

- **Registry**: `https://www.gov.pl/web/bip/spis` → 302 → ZIP → `subjects.xml`.
  Measured: 13,296 rows, 13,178 unique URLs, **9,744 unique hosts**; fields
  `id, name, url, place, communeTercCode`, contacts. Self-declared, ~3 "w przygotowaniu",
  69 duplicate URLs.
- **Sitemaps**: only **16.7%** of hosts expose one (120-host random sample). Median 55 URLs,
  mean 1,037, max 11,897 → power law. Sitemaps index **HTML pages, not attachments**, so
  document discovery must follow links.
- **Platform families** (registry hosts): own-domain 5,160 · `*.bip.gov.pl` 2,187 ·
  `gov.pl/web` 535 · naszbip 388 · wikom 346 · szkolnastrona 314 · biuletyn.net 192 ·
  lubelskie 137 · biposwiata 121 · ibip 99 · edupage 93 · 4bip 74 · bip.net 60 ·
  bip.info.pl 25.
- **Document URL patterns observed** (classifier seed):
  `/attachments/download/<id>` · `/attachments/<id>/download/<slug>` · `/api/files/<id>` ·
  `/fobjects/download/<id>/<slug>.html` · `/download/attachment/<id>/<file>` ·
  `/plik,<id>,<slug>.pdf` · `/documents/<a>/<b>/<file>/<uuid>` · `getFile?id=` ·
  `plik.php?id=` · `dokument.php?iddok=` · `/res/serwisy/pliki/<id>` ·
  `/resource/<id>/<file>.pdf` · `/upload/pliki/<file>.pdf` · `/system/obj/<file>.pdf` ·
  `/fls/bip_pliki/...`.
- **Structured feeds are rare (~1–4% of hosts)**: Wrocław `/przetargi/xml/1/1` (100 rec/page,
  `nr-sprawy, wartosc-zamowienia, termin-skladania-ofert`), Warszawa
  `POST /o/rest/central-registry/agreement` (JSON), Katowice SharePoint OData,
  Netkoncept per-page `/xml`. Capture as-is; do not build adapters around them first.
- **PDFs**: ~30–50% need OCR; ~85–90% are usable for numbers; declarations worst.
  (Relevant to iteration 2, not now.)
- **Churn**: ~2.5% of hosts are dead at any time.

## 4. Architecture

```
bip_registry  ──> hosts table ──> frontier (SQLite)
                                    │
                        bip_fetcher │ robots · rate-limit · conditional GET
                                    ▼
                     ┌── HTML/listing ──> link extractor (generic | adapter)
                     │                        └──> enqueue pages + docs
                     └── document ──────> bip_store (tar.zst bundle + manifest)
                                            └──> provenance chain + sha256 dedup
```

Components:
- `bip_registry` — ingest registry → host rows + platform fingerprint.
- `bip_frontier` — SQLite state store (source of truth for what is new/changed/gone).
- `bip_fetcher` — HTTP layer: `curl_cffi` impersonate, robots cache, per-host token bucket,
  retries/backoff, conditional GET.
- `bip_adapters` — platform-specific extractors; generic fallback for the long tail.
- `bip_store` — blob writer (local dir first, GCS later), bundling, manifest.
- `bip_cli` — `koryta_scrape_bip` entrypoint: `registry`, `crawl`, `report`, `prune`.

## 5. Frontier schema (SQLite)

```sql
CREATE TABLE hosts (
  host TEXT PRIMARY KEY, name TEXT, teryt TEXT, source_url TEXT,
  platform TEXT, adapter TEXT, robots TEXT, crawl_delay REAL,
  last_crawled TEXT, status TEXT          -- ok|robots-deny|dead|blocked
);
CREATE TABLE urls (
  url TEXT PRIMARY KEY, host TEXT, kind TEXT,      -- page|listing|feed|doc
  discovered_from TEXT, depth INTEGER, section TEXT,
  content_type TEXT, size INTEGER, sha256 TEXT,
  etag TEXT, last_modified TEXT,
  first_seen TEXT, last_checked TEXT, last_status INTEGER,
  state TEXT                              -- new|seen|unchanged|modified|gone|blocked|error
);
CREATE TABLE docs (
  sha256 TEXT PRIMARY KEY, url TEXT, host TEXT,
  content_type TEXT, size INTEGER, filename TEXT, title TEXT,
  bundle TEXT, bundle_offset INTEGER,
  chain TEXT,                             -- JSON: [{url,title,section}, ...]
  first_seen TEXT, last_seen TEXT,
  pages INTEGER, needs_ocr INTEGER
);
CREATE TABLE url_aliases (url TEXT PRIMARY KEY, sha256 TEXT);  -- many URLs → one blob
CREATE TABLE runs (
  run_id TEXT, started TEXT, finished TEXT,
  hosts INTEGER, fetched INTEGER, docs_new INTEGER,
  docs_unchanged INTEGER, errors INTEGER
);
```

## 6. Crawl algorithm

1. **Seeds**: registry URL + host root. Try `sitemap.xml` (follow sitemap index, gunzip
   `.gz` children), then `robots.txt` `Sitemap:` directives.
2. **Classify** each response:
   - content-type `application/pdf|msword|officedocument|zip` → document;
   - else URL matches a document pattern (§3) → document (verify by fetch);
   - else page.
3. **Extract** links from pages with the adapter if the host matches a known platform,
   otherwise generic (`<a href>` same-host, normalized).
4. **Bound** discovery: depth ≤ 4, same-host only, per-host page cap (default 5,000),
   section allow-list for paginators/calendars.
5. **Store** documents (bundle + manifest) and HTML snapshots of listing/entity pages.
6. **Persist** frontier state after each host (resumable).

## 7. Provenance

For every document keep the discovery chain plus harvested metadata:

```json
{
  "sha256": "…", "url": "https://bip.x.pl/attachments/download/97417",
  "host": "bip.x.pl", "content_type": "application/pdf", "size": 231940,
  "title": "oświadczenie roczne za 2020 rok",
  "chain": [
    {"url": "https://www.gov.pl/web/bip/spis", "title": "Urząd Miejski X"},
    {"url": "https://bip.x.pl/", "title": "BIP — strona główna"},
    {"url": "https://bip.x.pl/artykuly/71415/oswiadczenia-majatkowe", "section": "oświadczenia majątkowe"},
    {"url": "https://bip.x.pl/oswiadczenie-majatkowe/1147901/grzybowski-piotr", "title": "Grzybowski Piotr"}
  ],
  "first_seen": "2026-09-16T…", "last_seen": "2026-09-16T…"
}
```

The chain is stored per document (not per URL) and is small — this is the audit/rebuild key.

## 8. Storage

- **Local (default in this container)**: `bip_crawl_out/hostname=<host>/<yyyy-mm>/<batch>.tar.zst`
  plus `manifest.jsonl`; HTML snapshots under `…/<yyyy-mm>/pages/`.
- **GCS (later, behind `--storage gcs`)**: same key layout in a dedicated bucket
  (default `koryta-pl-bip`), reusing `ctx.io` / `CloudStorage`.
- **Bundling, not compression**: PDFs are already DEFLATE-compressed; `tar.zst` is for
  object-count reduction (millions of tiny GCS objects are slow/expensive to list/read),
  expect ~0–5% size gain.
- **Dedup**: `sha256` is the primary blob identity; many URLs may alias one blob
  (`url_aliases`).

## 9. URL normalisation

- lowercase host, drop default ports, strip fragments.
- strip cache-busters seen in the wild: `t`, `ts`, `v`, `ver`, `version`, `cache`, `_`.
- decode double-encoded paths once (`%25C5%259B` → `%C5%9B`).
- keep `http`/`https` as discovered, record canonical form.

## 10. Incremental strategy

- Conditional GET (`If-None-Match`, `If-Modified-Since`); `304` → `unchanged`.
- Change signals: sitemap `lastmod`, RSS/feed entries, XML listing feeds.
- `sha256` mismatch on a `200` → `modified` (new blob, URL keeps history).
- `404/410` → `gone` (never hard-delete history).
- Cadence: registry monthly; hosts quarterly; hot sections (`oświadczenia`, `przetargi`)
  monthly. Reruns should be seconds per unchanged host.

## 11. Politeness

- Cache `robots.txt` per host; honor `Disallow` and `Crawl-delay` (observed: some hosts
  `Disallow: /` → mark `robots-deny`; Wrocław bans `/*pdf*` but serves documents via
  `/attachments/download/<id>`, which robots permits — robots governs paths, not types).
- Per-host token bucket (default 1 req/s), concurrency **across** hosts only.
- Identifying User-Agent with contact; exponential backoff on 429/503.

## 12. Repo integration

- New package `data/pipelines/src/scrapers/bip/` (`__init__.py`, `registry.py`,
  `frontier.py`, `fetcher.py`, `adapters/`, `store.py`, `cli.py`, `tests/`).
- Entry point `koryta_scrape_bip` in `pyproject.toml [project.scripts]`; register pipeline
  exports in `src/pipelines.py` if it should participate in the graph.
- Reuse: `src/stores/web.py` (`robot_txt_allowed`), the rate-limiter pattern from
  `src/scrapers/article/crawler.py`, `ctx.io` / `CloudStorage` for GCS, and
  `src/scrapers/tests/mocks.py` for tests.
- Emit `versioned/bip_hosts`, `versioned/bip_urls`, `versioned/bip_docs` JSONL so later
  pipelines can consume them; respect import-linter layers (`pyproject.toml`).

## 13. Environment caveats (this container)

- **GCS Application Default Credentials are missing** → local-first; GCS path implemented
  but unverified until creds/mount exist.
- `uv` only at `/home/mp/Projects/koryta/data/pipelines/.venv/bin/uv`; the worktree venv is
  isolated (`pipelines.pth` → worktree `src`).
- No `libGL` (future OCR must use `opencv-python-headless`) — not needed for iteration 1.

## 14. Milestones & acceptance

| # | Deliverable | Acceptance |
|---|---|---|
| M1 | Registry ingest → `bip_hosts` | 13,296 rows / 13,178 URLs / 9,744 hosts reconciled |
| M2 | Frontier + generic crawler + doc classifier, run on 100 random hosts | report: docs/host, PDF share, robots-blocked, dead hosts, bundle size, rerun time |
| M3 | Provenance + sha256 dedup + `tar.zst` bundling | every doc has a non-empty chain; zero duplicate blobs |
| M4 | Platform adapters (`attachments/download`, Netkoncept, bip.info.pl, malopolska) | measurable docs/host uplift vs generic on those platforms |
| M5 | Scale to all hosts + incremental rerun | 2nd run >90% URLs `unchanged`, runtime ≪ first run |

## 15. Metrics per run

hosts crawled · pages fetched · docs new/unchanged · bytes stored · bundles written ·
robots-blocked · dead hosts · 4xx/5xx · rerun duration.

## 16. Risks / open questions

- **Runaway discovery** (paginators, calendars, search result loops) → depth + per-host cap
  + section allow-list.
- **Duplicate content** under many URLs → sha256 dedup + alias table.
- **Scanned declarations** dominate OCR cost later; crawler only stores, flags nothing yet.
- **robots/legal**: reuse is permitted (ustawa z 11.08.2021 o otwartych danych) with
  attribution; still honor per-host robots and rate limits.
- **Storage sizing**: 2.5M PDFs ≈ 1.5–2.5 TB → bundle format chosen, bucket TBD.
- **Open**: bucket name (`koryta-pl-bip` vs reuse `koryta-pl-crawled`); whether to keep HTML
  snapshots of *all* pages or only listing/entity pages (current: listing/entity only).

## 17. As built (iteration 1, 2026-09-17)

### Layout

| File | Layer | Purpose |
|---|---|---|
| `src/stores/bip_registry.py` | stores | registry ZIP download + unpack (`zipfile`/`io` are forbidden in scrapers) |
| `src/scrapers/bip/registry.py` | scrapers | `parse_subjects_xml` → rows, `hosts_from_entries` → hosts |
| `src/scrapers/bip/frontier.py` | scrapers | SQLite state store (hosts / urls / docs / runs), thread-safe writes |
| `src/scrapers/bip/classify.py` | scrapers | document-URL + content-type detection, link extraction, section/low-value filters |
| `src/scrapers/bip/ratelimit.py` | scrapers | per-host min-interval limiter (injectable clock) |
| `src/scrapers/bip/store.py` | scrapers | `LocalBundleStore`: `tar.gz` per (host, date) + `index.txt` |
| `src/scrapers/bip/crawler.py` | scrapers | per-host loop, injectable fetch/robots |
| `src/bip_cli.py` | top-level | `koryta_scrape_bip registry\|crawl\|stats`; concrete HTTP + robots + wiring |

### Reuse decisions (kept)

- `BatchClient.batch_upload` shape reused as `LocalBundleStore` (tar.gz + `index.txt`, same
  naming) so switching to GCS is a class swap. **Not yet wired to GCS** (no ADC here).
- `NormalizedParse` for host normalisation (strips `www.`, which merged 9,707 hosts).
- Token bucket copied (thread-safe, per-host) rather than importing a private function.
- Robots reimplemented in `bip_cli.RobotsCache` (exempt layer): https→http fallback, 404
  means allow, unreachable means deny. The article crawler's `WebImpl` always used https
  and treated "robots unavailable" as deny.
- `CrawlQueue`/`PostgresCrawlQueue` **not** reused (claim/lock/priority queue, wrong model).

### Crawl-order fixes found during the smoke test

Plain BFS spent the whole page budget on a homepage menu (Częstochowa: 40 depth-1 links,
0 documents). Changes:
1. documents found on a page are fetched **before** the rest of the page queue;
2. URLs matching document-bearing sections (`oswiadczen`, `przetarg`, `umow`, `budzet`,
   `majatek`, `jednostk`, …) are queued first;
3. low-value URLs (banners, `view/*`, sitemap, search, print, rss) are skipped;
4. trailing-slash duplicates normalised.

### M1 result

`registry` ingest: **13,306 registry rows → 13,179 unique URLs → 9,707 hosts**
(9,707 < 9,744 because `www.` variants merge). 127 duplicate URLs.

### M2 smoke result

`bip.kleszczow.pl`: 40 pages → **37 documents / 42.5 MB** after the ordering fix (0 before).
`bip.czestochowa.pl` seed failed once with a transient error, reachable on retry.

### M2 run: first 100 registry hosts (2026-09-17, ~80 min wall)

| Metric | Value |
|---|---|
| hosts crawled | 103 (100 + 3 smoke) — 44 ok, 31 partial, 28 dead |
| URLs seen | 9,006 (4,902 pages, 4,104 docs) |
| fetch errors | 401 status-0, 491 HTTP ≥ 400 |
| documents stored | **4,243 (4.8 GB)** |
| PDFs | **3,439 (4.4 GB) = 81%** |
| office/xls/zip/other | 804 (DOCX 336, DOC 164, force-download 137, …) |
| bundles | 63 completed (~3.6 GB on disk) |
| top hosts | uml.lodz.pl 500 docs, checiny.biuletyn.net 500, umlipno 500, cuwopoczno 500 |
| docs with missing blob | 1,362 (all from hosts killed mid-bundle) |

**Bug found and fixed:** `LocalBundleStore` was not thread-safe — 8 workers shared
`tarfile` handles and the bundle map, and the run **deadlocked** (`futex_wait`, CPU frozen)
after ~90 minutes with several `.part` bundles open. Fix: an `RLock` around every mutation,
plus a regression test (`test_store_is_thread_safe`). The 28 interrupted `.part` files were
deleted.

**Integrity follow-up:** a doc whose bundle was lost is no longer treated as a duplicate.
`Frontier.doc_bundle()` + `LocalBundleStore.blob_exists()` make the crawler re-store it, and
`record_docs` now upserts the bundle path. Re-crawling the five 500-doc hosts will repair the
1,362 missing blobs (the mechanism is covered by `test_missing_bundle_is_restored`).

**Throughput observation:** `max_docs_per_host=500` at 1 req/s means a doc-rich host takes
8+ minutes; five such hosts dominated the run. Next iteration should either fetch documents
with a small per-host concurrency (e.g. 3–4 in flight, still ~1 req/s) or lower the cap.


