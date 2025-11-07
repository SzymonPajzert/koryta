To run the binaries in this directory, you need to [install poetry](https://pypi.org/project/poetry/). Then, you can install it by running ([see demo](https://pypi.org/project/poetry/))

```bash
gcloud auth login # this is needed for buckets - https://docs.google.com/document/d/1bGrtID-mIFFitvfR_cEmmbV8hvTLDIWFQhnRiSwDlyY
python3.13 -m venv ./.venv
. ./.venv/bin/activate
pip install poetry
poetry install
```

Data mining code is located in the `src` directory. Some tests are located in the `tests` dir, while others are in the `src`, near the libraries that are tested.

## Required access

Make sure you have:

- Read access to [`koryta-pl-crawled`](https://console.cloud.google.com/storage/browser/koryta-pl-crawled;tab=objects?forceOnBucketsSortingFiltering=true&authuser=0&hl=en-GB&project=koryta-pl&prefix=&forceOnObjectsSortingFiltering=false) GCS (Google Cloud Storage) bucket in GCP.
- Writing access to [`koryta-pl-crawled`](https://console.cloud.google.com/storage/browser/koryta-pl-crawled) is needed to run the scraper

## Basic information

Note that everything costs. Not too much, but don't redownload data

- Queries to Firestore cost $0.03
- GCS egress and ingress costs something as well per GB

During the course of the running of multiple binaries here, there will be two directories created along `src` and `tests` folders. They are defined in the `src/util/config.py` directory

- `versioned` - Output of the scripts - processed data. The idea is to have a versioned copy of these folders. Currently I'm copying them once a day manually, to have a data to fallback on and compare.

- `downloaded` - Downloaded local verison of the data from a [`koryta-pl-crawled`](https://console.cloud.google.com/storage/browser/koryta-pl-crawled;tab=objects?forceOnBucketsSortingFiltering=true&authuser=0&hl=en-GB&project=koryta-pl&prefix=&forceOnObjectsSortingFiltering=false) bucket in GCP or from external sources specified in the scripts (e.g. PKW processing)

## Scripts

You can run each script with `poetry run scripts-name`.

Refer to `pyproject.toml` for the most up-to-date list of the scripts available there:

```toml
[project.scripts]
# This script runs a scraper to download articles from news websites
# This is WIP and doesn't work until you get the write access to GCS.
scrape_articles = "scrapers.article.crawler:crawl"

# This is a nice small script to run example version of the extraction
# It contains a minimal logic to find a single person. Should work for you.
scrape_articles_example = "scrapers.article.extract_example:extract"

# The following scripts process the data from public / crawled sources"
# TODO #137 - to process them in order when needed.

# Downloads 2GB of data and extracts people with political connections
# It filters political people (heuristic of linked pages)
# Extracts names, second names, dates of birth
# TODO #139 - Extract people's political parties from wiki.
scrape_wiki = "scrapers.wiki.process_articles:main"
# TODO #138 - add extractor of companies as well.

# Downloads XLS, ZIP and CSV files from PKW
# Tries to unify the data
# Run pytest to check what is missing there.
scrape_pkw = "scrapers.pkw.process:main"

# This one costs a lot of money
# You shouldn't be able to run it without a key
scrape_rejestrio = "scrapers.krs.scrape:scrape_rejestrio"

# Downloads copied data from rejestrio and extracts people and companies.
scrape_krs_people = "scrapers.krs.process:extract_people"
scrape_krs_companies = "scrapers.krs.process:extract_companies"

# Downloads items from the koryta.pl website
scrape_koryta_people = "scrapers.koryta.download:process_people"
scrape_koryta_articles = "scrapers.koryta.download:process_articles"

# This runs the actual analysis, merging the upstream sources.
analyze_people = "analysis.people:main"

# 'jupyter lab' is available as well for notebooks
```
