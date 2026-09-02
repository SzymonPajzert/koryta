# The capture extractor

A single-purpose HTTP service: given a page someone captured in their browser
and stored in `gs://koryta-pl-crawled`, parse it, score it, extract facts and
submit them to `/api/ingest/extraction` — the same collection the nightly
pipeline writes to, so the facts land in the same `/ekstrakcje` review queue.

It exists because of paywalls. The crawler fetches anonymously and gets a
teaser; a logged-in reader has the article rendered in front of them. Everything
downstream of "we have the html" is already written and batch-shaped, so this
service is a thin wrapper that runs it for one document
(`scrapers.article.oneshot`) rather than a second implementation of it.

## Where it sits

```
extension ──▶ POST /api/ingest/page ──▶ gs://koryta-pl-crawled/…tar.gz
   (Nuxt)              │                 (exactly where the crawler writes)
                       ├──▶ nodes/{article}      article node, auto-approved
                       ├──▶ articlePages/{id}    the job, status "stored"
                       └──▶ Cloud Tasks ──▶ THIS ──▶ url_store  (mark fetched)
                                              ├──▶ POST /api/ingest/extraction
                                              └──▶ articlePages/{id} → "done"
```

Registering with `url_store` is what makes a capture a normal crawl result:
`ArticleDoneUrls` reads it, so the nightly run re-parses the same archive with
the local model. The fast path is a preview, not a replacement — which is also
why its facts carry their own `tag` (`capture_v1`), distinguishable from the
batch run's in `/ekstrakcje`.

## Running it locally

```
cd data/pipelines
KORYTA_API_URL=http://localhost:3000 \
FIREBASE_WEB_API_KEY=AIzaSyD54RK-k0TIcJtVbZerx2947XiduteqvaM \
LLM_API_KEY=$OPENROUTER_APIKEY \
ALLOW_UNAUTHENTICATED=1 \
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
uv run uvicorn service.app:app --port 8081
```

and point the frontend at it with `EXTRACTOR_DISPATCH=direct
EXTRACTOR_URL=http://localhost:8081`, which skips Cloud Tasks and calls the
service straight. Both of those are read by `nuxt.config.ts` at startup, so they
have to be on the command that launches the dev server rather than exported
afterwards. `GET /health` reports which variables are still missing rather than
making you find out on the first capture.

The two emulator variables are what let the run finish rather than merely start.
Firestore is where the job document lives; auth is where the service redeems its
own custom token for the id token `/api/ingest/extraction` wants, and without it
that exchange goes to real Firebase with a token only the emulator would
accept — which fails at the last step, after the page has been parsed and the
model has been paid for.

Nothing in that loop touches `gs://koryta-pl-crawled`. There is no storage
emulator, so under `USE_EMULATORS=true` the capture endpoint writes the archive
to `$CAPTURE_LOCAL_DIR` (default `$TMPDIR/koryta-captures`) under the same
`hostname=…/date=…/uid_….tar.gz` name and hands back a `file://` path, which
`read_captured_html` reads exactly as it reads a `gs://` one.

## Configuration

| Variable                             | Default                        |                                                               |
| ------------------------------------ | ------------------------------ | ------------------------------------------------------------- |
| `KORYTA_API_URL`                     | —                              | required, e.g. `https://koryta.pl`                            |
| `FIREBASE_WEB_API_KEY`               | —                              | required; public, same value as `nuxt.config.ts`              |
| `LLM_API_KEY`                        | —                              | required; also read from `OPENROUTER_APIKEY`/`OPENAI_API_KEY` |
| `LLM_BASE_URL`                       | `https://openrouter.ai/api/v1` | any OpenAI-compatible endpoint                                |
| `LLM_MODEL`                          | `qwen/qwen3-30b-a3b-instruct-2507` | see `DEFAULT_LLM_MODEL`                                   |
| `LLM_LANES`                          | `4`                            | concurrent requests; the per-fact judgements use them         |
| `EXTRACTOR_UID`                      | `capture-extractor`            | the Firebase uid this service signs in as                     |
| `EXTRACTION_TAG`                     | `capture_v2_qwen3.8-27b_attempt_lookup` | stamped on every submitted fact                      |
| `MATCH_PEOPLE`                       | `true`                         | look facts' people up in the `KorytaPeople` dump and send them as `koryta_ids` |
| `PEOPLE_INDEX_PATH`                  | unset                          | a `person_koryta` jsonl or `backup.tar.gz` to use instead of the newest in the shared cache |
| `PEOPLE_INDEX_TTL_SECONDS`           | `86400`                        | how long an instance reuses its built index                   |
| `SHARED_CACHE_BUCKET`                | `koryta-pl-sharedcache`        | where the `KorytaPeople` dumps are read from                  |
| `VERIFY_FACTS`                       | `true`                         | run the rulebook judge before submitting                      |
| `MIN_KORYCIARSKI_SCORE`              | unset                          | skip submitting below this score                              |
| `URL_STORE_URL`, `URL_STORE_API_KEY` | unset                          | without these the nightly run will not see the capture        |

The model is deliberately not the batch pipeline's `Qwen/Qwen3-14B`: there is no
GPU behind Cloud Run, so this goes to a hosted endpoint. Facts from the two
runs will not be identical, which is what the tag is for.

It is also a much larger model than the batch run's, for the same reason the
score does not gate extraction here: this is one page a person chose, not one of
millions crawled, so the per-page cost that makes a 235B model impossible
nightly is a rounding error on a single capture — and a capture is the one path
where the reader is waiting for the answer and can see it be wrong.

### The people index

`MATCH_PEOPLE` links a submitted fact to the person page it is about, which
`/api/ingest/extraction` can only do when the request names the article's
people in `koryta_ids`. The names come from `KorytaPeople`'s output — the
newest `filename=person_koryta_<date>/…/backup.tar.gz` in the shared cache,
about 9,300 rows and 360 kB, built into a name index once per instance and
reused for `PEOPLE_INDEX_TTL_SECONDS` (a day).

Not from Firestore. Reading the person nodes directly is ~9,300 document reads
per refresh for a set that changes when somebody adds a person page and not
otherwise, and `KorytaPeople` is itself built from the nightly export — so the
dump is the same snapshot the batch path matched against, for one object read.
The cost of that choice is staleness: a person page created since the last
`KorytaPeople` run is not in the index, and their facts arrive unlinked until
it runs again.

The dump is picked by taking the greatest blob name under the prefix. Both the
date in the filename and the `datetime=` segment sort chronologically, so that
is the most recent run whoever ran it — deliberately not
`stores.storage.download_backup`, which prefers the current user's own backups
and prompts on stdin to choose between users when it finds none. There is no
stdin on Cloud Run.

`PEOPLE_INDEX_PATH` overrides all of it with a local file, which is how the
development loop runs without the bucket and how to pin a known dump into the
image.

## Deploying

Nothing here deploys itself — these are the commands to run once, by hand.

```bash
PROJECT=koryta-pl
REGION=europe-central2
SA=capture-extractor@$PROJECT.iam.gserviceaccount.com

gcloud iam service-accounts create capture-extractor --project=$PROJECT

# Read the archives it was pointed at, and update the job document.
gcloud storage buckets add-iam-policy-binding gs://koryta-pl-crawled \
  --member=serviceAccount:$SA --role=roles/storage.objectViewer
gcloud projects add-iam-policy-binding $PROJECT \
  --member=serviceAccount:$SA --role=roles/datastore.user

# Read the people index. objectViewer, not objectAdmin: the bucket is shared
# with the pipelines' own runs and this service must never write into it.
gcloud storage buckets add-iam-policy-binding gs://koryta-pl-sharedcache \
  --member=serviceAccount:$SA --role=roles/storage.objectViewer

# Sign its own Firebase custom token. Without a key file firebase_admin signs
# through the IAM API, so the account needs this *on itself*.
gcloud iam service-accounts add-iam-policy-binding $SA \
  --member=serviceAccount:$SA --role=roles/iam.serviceAccountTokenCreator

# The LLM key, as a secret rather than an env var, and read by the account the
# revision runs as. `printf` rather than `echo`: a trailing newline becomes part
# of the secret, and OpenRouter then answers 401 exactly as it would to a wrong
# key. `read -rs` keeps it out of the shell history.
gcloud secrets create openrouter-api-key --project=$PROJECT \
  --replication-policy=automatic
read -rs -p "OpenRouter key: " KEY
printf '%s' "$KEY" | gcloud secrets versions add openrouter-api-key \
  --project=$PROJECT --data-file=-
unset KEY

# Checked when the revision is created, so a missing grant fails the deploy
# rather than the first capture. A secret that does not exist reports the same
# "Permission denied on secret" — Cloud Run will not distinguish the two.
gcloud secrets add-iam-policy-binding openrouter-api-key --project=$PROJECT \
  --member=serviceAccount:$SA --role=roles/secretmanager.secretAccessor

# The registry the image is pushed to. `builds submit --tag` will not create it,
# and a missing one is only reported after the whole image has been built — as
# `name unknown: Repository "koryta" not found` from the push step.
gcloud artifacts repositories create koryta --repository-format=docker \
  --location=$REGION --project=$PROJECT

gcloud builds submit data/pipelines \
  --tag=$REGION-docker.pkg.dev/$PROJECT/koryta/capture-extractor

gcloud run deploy capture-extractor \
  --image=$REGION-docker.pkg.dev/$PROJECT/koryta/capture-extractor \
  --region=$REGION --service-account=$SA --no-allow-unauthenticated \
  --memory=2Gi --cpu=1 --timeout=1800 --max-instances=4 \
  --set-env-vars=KORYTA_API_URL=https://koryta.pl,FIREBASE_WEB_API_KEY=AIzaSyD54RK-k0TIcJtVbZerx2947XiduteqvaM \
  --set-secrets=LLM_API_KEY=openrouter-api-key:latest

gcloud services enable cloudtasks.googleapis.com --project=$PROJECT
gcloud tasks queues create article-extraction --location=$REGION
```

## Letting the nightly run see a capture

The deploy above leaves `url_store` off, which costs the second pass: a capture
is extracted once by this service and never re-parsed by the batch pipeline,
because `ArticleDoneUrls` finds it by the registration that is not being written.
The facts still land in `/ekstrakcje`; they are just the fast model's only word
on the page.

`url_store_enabled` wants a url *and* a key, so turning it on is both halves —
mounting the key alone does nothing, silently:

```bash
gcloud secrets create url-store-api-key --project=$PROJECT \
  --replication-policy=automatic
read -rs -p "url_store key: " KEY
printf '%s' "$KEY" | gcloud secrets versions add url-store-api-key \
  --project=$PROJECT --data-file=-
unset KEY

gcloud secrets add-iam-policy-binding url-store-api-key --project=$PROJECT \
  --member=serviceAccount:$SA --role=roles/secretmanager.secretAccessor

gcloud run services update capture-extractor --region=$REGION \
  --update-env-vars=URL_STORE_URL=https://… \
  --update-secrets=URL_STORE_API_KEY=url-store-api-key:latest
```

Then let the frontend reach it. The App Hosting backend runs as its own service
account (`APP=…`); it needs to write the archive, enqueue the task, and act as
the extractor's account when minting the task's OIDC token:

```bash
gcloud storage buckets add-iam-policy-binding gs://koryta-pl-crawled \
  --member=serviceAccount:$APP --role=roles/storage.objectCreator
gcloud projects add-iam-policy-binding $PROJECT \
  --member=serviceAccount:$APP --role=roles/cloudtasks.enqueuer
gcloud iam service-accounts add-iam-policy-binding $SA \
  --member=serviceAccount:$APP --role=roles/iam.serviceAccountUser
gcloud run services add-iam-policy-binding capture-extractor --region=$REGION \
  --member=serviceAccount:$SA --role=roles/run.invoker
```

and set on the App Hosting backend (`apphosting.yaml` or the console):

```
EXTRACTOR_DISPATCH=tasks
EXTRACTOR_URL=https://capture-extractor-….run.app
EXTRACTOR_LOCATION=europe-central2
EXTRACTOR_QUEUE=article-extraction
EXTRACTOR_SERVICE_ACCOUNT=capture-extractor@koryta-pl.iam.gserviceaccount.com
```

Until `EXTRACTOR_DISPATCH` is set the capture path still works: the html is
stored and the article node created, the job document is marked `error` with
"extractor not configured", and the nightly pipeline picks the page up from the
bucket as usual.

## Cold starts

The image installs the scrapers package's whole base dependency set (pandas,
duckdb, lxml, pyarrow — the `ml` group with torch is excluded), so a cold start
is on the order of ten seconds. That is invisible behind Cloud Tasks, which is
part of why the capture flow is asynchronous. Set `--min-instances=1` if the
wait ever becomes worth paying for.
