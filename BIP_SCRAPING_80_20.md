# BIP scraping — 80/20 recon & plan

Working note. **Untracked, not committed.** Worktree: `/home/mp/Projects/koryta.wt/bip-scraping`
(branch `bip-scraping`, off local `main` @ `2d41b223`). Compiled 2026-09-15.

Legend: **[V]** = personally verified in-container during this recon; **[R]** = reported by a
research worker, not independently re-verified.

## TL;DR

We do **not** need to discover 13k BIP sites by crawling. Poland has an official, downloadable
central registry of BIP addresses. The high-value data for koryta.pl is not "all BIPs", it is
**JST/Skarb Państwa ownership of companies + jednostki organizacyjne**, which is available first
as national open data (XLS/CSV) and second from a handful of reusable BIP platforms.

Order of work: **national datasets → platform templates → the long tail. Never hand-dump again.**

## 1. Getting the complete list of BIPs (solved)

Legal basis: art. 9 ustawy o dostępie do informacji publicznej — the minister runs the central
BIP portal with a list of obligated entities and links. That list is machine-readable.

- **Registry export**: `https://www.gov.pl/web/bip/spis` → 302 → `https://aplikacje.gov.pl/app/bip-back/export/subjects/published` **[V]**
  - HTTP 200, 1,537,528 B **ZIP** → `subjects.xml`, 9,778,269 B **[V]**
  - **13,296 rows, 13,178 unique URLs** **[V]**
  - Fields: `id, name, url, place, postName, street, zipCode, phone, fax, email, redactorEmail/Phone/Fax, communeTercCode` (7-digit TERC), `parentId, number, createDate, updateDate` **[V]**
  - Note: in this container gov.pl needs `curl -k` (incomplete CA chain) **[V]**
- **Archive**: `https://www.gov.pl/web/bip/archiwum` → `.../export/subjects/archived`, 124 rows **[R]**
- **Search API**: `https://aplikacje.gov.pl/app/bip-back/api/subjects?name=<>=3 chars>&archive=false` **[R]**
- **Backbone for JST**: TERYT/eTeryt full files (form-gated) or GUS API (free key) **[R]**;
  16 woj., 314 powiaty + 66 miast na prawach powiatu, 2,479 gminy (GUS 1.01.2025) **[R]**
- **No dataset on dane.gov.pl** for BIP addresses — the gov.pl export is the only official source **[R]**

Caveats: the list is self-declared; ~3 entries are "strona w przygotowaniu"; 69 duplicate URLs;
`communeTercCode` is the seat/location, not always the represented unit.

Hosting shape (computed from the export) **[R]**: `*.bip.gov.pl` 2,205 sites; `gov.pl/web/*` ~1,216;
SaaS vendors incl. `naszbip.pl` 389, `wikom.pl` 346, `szkolnastrona.pl` 322, `biuletyn.net` 199;
`bip.<domain>` 2,722; `<domain>/bip...` 1,422.

## 2. What we already have vs. the gap

Current local state **[R]**:

- `data/pipelines/src/scrapers/krs/data.py` holds **723 hardcoded KRS ids (~722 unique)** across 13 blocks;
  only **~237 are JST-related**, from **8 locations** (3 voivodeships + 5 cities). No owner→company
  edge, no share %.
- `company_krs` 10,499 rows, `company_company` 14,950 rows — but **no owner field** (only corporate
  `children`/`parents`).
- Manual BIP dumps referenced in TODOs: `bip.mkidn.gov.pl` (MKiDN), `bip.warszawa.pl`, `bip.um.wroc.pl`.

Gap a BIP effort closes: explicit **JST/Skarb Państwa → company** edges with ownership stakes, for
all ~380 powiaty and ~1,200+ gminy, plus fundacje and non-KRS jednostki organizacyjne — replacing
hand dumps.

## 3. 80/20 target tiers

### Tier 0 — national machine-readable datasets (hours, highest yield)

1. **dane.gov.pl dataset 1198** — "Wykaz spółek z udziałem Skarbu Państwa", Prokuratoria Generalna.
   37 XLS resources, quarterly 2018 → 2026-06-30. API verified: `https://api.dane.gov.pl/1.4/datasets/1198?include=resources` HTTP 200 **[V]**.
   Gives the national SP register in one fetch. `xlrd` is already a base dependency. **Start here.**
2. **dane.gov.pl JST open data** — search `api.dane.gov.pl/1.4/resources?q=wykaz+jednostek+organizacyjnych`
   and `...spółek z udziałem gminy...`. Published as CSV/XLSX/XML per unit (examples: Gmina Marki CSV,
   Przemyśl XML/CSV/XLSX) **[R]**. Zero parsing difficulty; long tail, can be swept by API.
3. **MKiDN wykaz** (the repo's `krs/data.py:406-411` TODO) — only **9 PDFs**, wykaz unchanged since 2022 **[R]**.
   Low value, text-based PDFs. Defer; #1198 supersedes it.

### Tier 1 — platform-scoped crawlers (days, high reuse)

4. **SharePoint OData REST BIPs** — e.g. Katowice: `GET /_api/web/lists?$select=Title,ItemCount,Hidden`
   with `Accept: application/json;odata=verbose` → JSON inventory (Jednostki_podlegle 444, Osoby 1,906,
   Dokumenty 100,715) **[R]**. One adapter, reusable on other SharePoint BIPs.
5. **Netkoncept `/xml` (BIP-XML standard) + `/sitemap.xml`** — clean per-page XML
   (`<strona><adres-url><naglowek><sciezka-menu><tresc><modyfikacja><uzytkownik><zalaczniki>`) **[V on bip.rzeszow.rio.gov.pl]**.
   Needs the vendor's client list from registry fingerprinting. `/rss` also available here and on
   Wrocław/Toruń/Olsztyn **[R]**.
6. **RSS change monitors** for city BIPs + RIOs — hours of work, useful for incremental updates **[R]**.

### Tier 2 — replace existing manual dumps

7. `bip.warszawa.pl` (open robots + `sitemap.xml`), `bip.um.wroc.pl` (`/rss`), `bip.lodz.pl`
   (WordPress, plain HTML + sitemap) — server-rendered, straightforward **[R]**.
8. `gov.pl/web/*` (~1,216) and `*.bip.gov.pl` (2,205) — one shared CMS, template once **[R]**.

### Tier 3 — skip for now

9. Long-tail static/one-off BIPs, SPAs (e.g. Lublin/Edito needs a headless browser) **[R]**.

**80/20 claim**: Tier 0 + 3-4 platform templates should cover the large majority of usable
JST/Skarb Państwa ownership data; the 13k long tail is mostly duplicate PDFs/HTML.

## 4. Integration points in this repo (from code recon)

- All sources implement `Pipeline` (`src/scrapers/stores/__init__.py:662`, `process` :684,
  `output_class` :688); register in `src/pipelines.py:53`, CLI `src/koryta.py`, context builders
  `src/conductor.py:237`.
- Entities: `Company` (`src/entities/company.py:50`, has `parents: [Owner(krs, teryt)]`, `is_public`,
  `supervisory_organ`); `Source.source` Literal (`:7`) needs a new `"bip"` value.
- Manual lists feed `CompaniesHardcoded.register_partials` → `CompaniesKRS` (`src/scrapers/krs/list.py:256,460`)
  → `Companies` → `CompanyScores` / `CompaniesPayloads` / uploader (`owners`, `owner_teryt`,
  `owner_skarb_panstwa`).
- HTTP conventions to copy: `curl_cffi impersonate="chrome136"` + robots via
  `ctx.web.robot_txt_allowed` + token-bucket rate limit (`src/scrapers/article/crawler.py:19,34,84,194`).
- New source dir `src/scrapers/bip/` + tests via `src/scrapers/tests/mocks.py`; keep import-linter
  layers (`pyproject.toml:247`). Best patterns to copy: `kmgp/companies.py`, `pkw/sources.py`,
  `map/teryt.py`.
- No PDF library in dependencies — only relevant if we revive the MKiDN PDF path (Tier 0.3, deferred).

## 5. First sprint (ordered)

1. **Registry ingest**: download the ZIP, parse `subjects.xml`, emit a `bip_subjects` dataset
   (id, name, url, place, teryt) cached like other sources; join TERYT. Reconcile counts
   (13,296 rows / 13,178 unique URLs) as the acceptance check.
2. **Dataset 1198**: fetch the 37 XLS, normalize to `Company`/`Owner` edges, tag `source="bip"`
   (or a dedicated `"sp-wykaz"`), feed `CompaniesKRS`. Acceptance: row + name/KRS reconciliation
   against the XLS.
3. **dane.gov.pl JST sweep**: API-driven search for wykazy jednostek/spółek; ingest where format is
   tabular. Report which gminy are covered.
4. **One platform crawler proof**: Katowice OData (JSON) or one Netkoncept `/xml` client; prove the
   adapter + politeness (robots, crawl-delay 5s, identifying UA).
5. **Host fingerprint ranking**: group the 13,178 registry URLs by hostname and CMS marker to
   decide the next platform to template.

## 6. Risks / environment caveats

- `gov.pl` and `bip.mkidn.gov.pl` were unreachable/timeout from this container for one worker;
  gov.pl works with `curl -k` **[V]**. Verify reachability per target before planning a crawl.
- GCS Application Default Credentials are **not available in this container** (same failure in the
  main checkout) — local `--no-backup`/`--cache-only` runs only until the mount/secrets are fixed.
- robots.txt varies wildly: Zielona Góra `Disallow: /`; Wrocław bans `/*pdf*`; Poznań crawl-delay 5
  and disallows its own API. Honor them; identify the crawler; keep rate low.
- Legal: ustawa z 11.08.2021 o otwartych danych i ponownym wykorzystywaniu — reuse OK with attribution.
- Registry is self-declared and incomplete by nature; treat TERYT join as best-effort.

## 7. Open questions

- Which exact dataset is the first deliverable for koryta.pl: SP companies only, or JST companies too?
- Do we want continuous monitoring (RSS/coverage) or one-off snapshots?
- Is a new top-level pipeline (`koryta_scrape_bip`) wanted, or do BIP results feed into
  `CompaniesKRS` via `register_partials`?
