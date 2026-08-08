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
cd data/scrapers
KORYTA_API_URL=http://localhost:3000 \
FIREBASE_WEB_API_KEY=AIzaSyD54RK-k0TIcJtVbZerx2947XiduteqvaM \
LLM_API_KEY=$OPENROUTER_APIKEY \
ALLOW_UNAUTHENTICATED=1 \
uv run uvicorn service.app:app --port 8081
```

and point the frontend at it with `EXTRACTOR_DISPATCH=direct
EXTRACTOR_URL=http://localhost:8081`, which skips Cloud Tasks and calls the
service straight. `GET /health` reports which variables are still missing rather
than making you find out on the first capture.

## Configuration

| Variable | Default | |
| --- | --- | --- |
| `KORYTA_API_URL` | — | required, e.g. `https://koryta.pl` |
| `FIREBASE_WEB_API_KEY` | — | required; public, same value as `nuxt.config.ts` |
| `LLM_API_KEY` | — | required; also read from `OPENROUTER_APIKEY`/`OPENAI_API_KEY` |
| `LLM_BASE_URL` | `https://openrouter.ai/api/v1` | any OpenAI-compatible endpoint |
| `LLM_MODEL` | `qwen/qwen3-32b` | |
| `LLM_LANES` | `4` | concurrent requests; the per-fact judgements use them |
| `EXTRACTOR_UID` | `capture-extractor` | the Firebase uid this service signs in as |
| `EXTRACTION_TAG` | `capture_v1` | stamped on every submitted fact |
| `VERIFY_FACTS` | `true` | run the rulebook judge before submitting |
| `MIN_KORYCIARSKI_SCORE` | unset | skip submitting below this score |
| `URL_STORE_URL`, `URL_STORE_API_KEY` | unset | without these the nightly run will not see the capture |

The model is deliberately not the batch pipeline's `Qwen/Qwen3-14B`: there is no
GPU behind Cloud Run, so this goes to a hosted endpoint. Facts from the two
runs will not be identical, which is what the tag is for.

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

# Sign its own Firebase custom token. Without a key file firebase_admin signs
# through the IAM API, so the account needs this *on itself*.
gcloud iam service-accounts add-iam-policy-binding $SA \
  --member=serviceAccount:$SA --role=roles/iam.serviceAccountTokenCreator

gcloud builds submit data/scrapers \
  --tag=$REGION-docker.pkg.dev/$PROJECT/koryta/capture-extractor

gcloud run deploy capture-extractor \
  --image=$REGION-docker.pkg.dev/$PROJECT/koryta/capture-extractor \
  --region=$REGION --service-account=$SA --no-allow-unauthenticated \
  --memory=2Gi --cpu=1 --timeout=1800 --max-instances=4 \
  --set-env-vars=KORYTA_API_URL=https://koryta.pl,FIREBASE_WEB_API_KEY=AIzaSyD54RK-k0TIcJtVbZerx2947XiduteqvaM \
  --set-secrets=LLM_API_KEY=openrouter-api-key:latest,URL_STORE_API_KEY=url-store-api-key:latest

gcloud tasks queues create article-extraction --location=$REGION
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
