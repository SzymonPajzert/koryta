To run the binaries in this directory you need [uv](https://docs.astral.sh/uv/). It
fetches the Python 3.13 this project pins by itself, so nothing else has to be
installed first.

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh

gcloud auth login # this is needed for buckets - https://docs.google.com/document/d/1bGrtID-mIFFitvfR_cEmmbV8hvTLDIWFQhnRiSwDlyY
gcloud auth application-default set-quota-project koryta-pl  # To access Google cloud resources.

uv sync --all-groups   # creates .venv and installs everything in uv.lock
```

Leave out `--all-groups` to skip the `ml` group (torch, spacy and the nvidia
runtimes, 4.5 GB) if you are not touching the extraction models. The model
weights themselves are not dependencies: `stores.textmodel.ner` fetches each
one into `models/` the first time it is asked for.

Dependencies live in `pyproject.toml` and are pinned in `uv.lock`; run
`uv lock` after editing the former and commit both.

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

You can run each script with `uv run scripts-name`.

Refer to `pyproject.toml` for the most up-to-date list of the scripts available there.