# Running the jobs on Cloud Run

A job runs as a Cloud Run job in `koryta-pl`, next to the buckets it reads and
writes, and Cloud Scheduler starts it. The image is the one `data/pipelines/Dockerfile`
builds for the capture extractor: it already carries the base dependencies every
job imports, so a job is that image with another command.

Nothing here deploys itself. These are the commands to run once, by hand, as the
project owner: `dev-workflow` can list Cloud Run jobs and executions, but cannot
create service accounts, grant roles, push images or touch Cloud Scheduler.

## koryta_scrape_krs_free, nightly

It runs between midnight and the Firestore export:

| Warsaw time | What                                                                                      |
| ----------- | ----------------------------------------------------------------------------------------- |
| 00:30       | Cloud Scheduler starts `krs-scrape-free`; the bulletin day that has just ended is fetched |
| 03:20       | `--max-minutes=170` - the job stops asking and writes its summary                         |
| 03:30       | `--task-timeout=3h` - Cloud Run stops whatever is still running                           |
| 04:00       | `scheduledFirestoreExport` dumps Firestore (`frontend/functions/src/index.ts`)            |

`--max-retries=0`, so a failed night is not retried into the export; the next
night rebuilds the queue and carries on. What a night does not reach is asked
the night after. On 2026-10-02 the queue held 6,762 companies, 13,367 requests -
mostly companies a rejestr.io response or a feed named and nobody has asked
api-krs about - which is about an hour and a half at ~0.4 s a request. After
that, a night asks about what the bulletin says changed.

Sized from a headless `--dry-run --no-backup` on predator (2026-10-02, a warm
`versioned/` and download cache): the queue takes 7 minutes to rebuild and
peaks at 4.5 GB. Unpinned, PeopleMerged's nightly rebuild made that 10 minutes
and 10 GB (`PINNED` in `krs_scrape_free`).

### Every run downloads its inputs again

A Cloud Run job starts each execution on an empty disk, so nothing predator
keeps in `versioned/` and `~/.cache/koryta/downloaded` survives from one night
to the next. Traced on that dry run, a run reads:

| What                                                                  |    Objects |      Size |
| --------------------------------------------------------------------- | ---------: | --------: |
| api-krs objects, all of them (`KRSCensoredPeople`, `CompaniesKRS`)    |     38,206 |   ~257 MB |
| the newest crawl of each rejestr.io object (`CompaniesKRS`)           |     22,540 |    274 MB |
| the day's Firestore export (`KorytaPeople`, `KorytaVotes`)            |        362 |     64 MB |
| pipeline backups restored (PeopleMerged, PeopleKRS, ProcessWiki, ...) |          4 | ~45 MB gz |
| the rejestr.io mirror archives, streamed three times                  |          2 | 3 x 29 MB |
| bucket listings: each host three times, ~1.1 KB of metadata an object | 77k a time |   ~265 MB |

On main, `CompaniesKRS` and `KRSCensoredPeople` fetch those objects one at a
time, which predator did at 8.5 a second: ~2 hours before the first api-krs
request, most of the night. So before this job goes to Cloud Run, merge
`nightly-krs-from-mirror`: `read_many` takes the compressed mirror's archives
and fetches only what they lack, 32 at a time; both pipelines read through it;
listings ask for name and size alone. It measured ~2.5 minutes a host cold.
What the archives lack is everything crawled since the mirror's last delta
(2026-07-31), and it grows every night until the compressor runs after the
scrape. The money is not the problem: ~1 GB a run from the `eu` bucket at
0.075 PLN/GiB plus ~61k reads is a few złoty a month.

Each run writes a summary to
`gs://koryta-pl-sharedcache/jobs/krs_scrape_free/runs/date=<day>/<run>.json`:
companies queued and asked, requests answered / empty / failed, uploads that
failed, bulletin days fetched, why it stopped. The exit code says the same in
brief: 0 everything asked was answered, 75 something is left for the next run
(deadline, api-krs refusing, a failed request or upload), 1 a crash.

```bash
PROJECT=koryta-pl
REGION=europe-central2
SA=krs-jobs@$PROJECT.iam.gserviceaccount.com
IMAGE=$REGION-docker.pkg.dev/$PROJECT/koryta/pipelines-jobs

gcloud iam service-accounts create krs-jobs --project=$PROJECT \
  --display-name="KRS jobs on Cloud Run"

# Read what the queue is built from: the crawl, its compressed mirror, and the
# pipeline outputs and job logs in the shared cache.
for bucket in koryta-pl-crawled koryta-pl-compressed koryta-pl-sharedcache; do
  gcloud storage buckets add-iam-policy-binding gs://$bucket \
    --member=serviceAccount:$SA --role=roles/storage.objectViewer
done
# Add objects, never replace or delete one: a crawl is uploaded create-only,
# and backups and run summaries are written under new names.
for bucket in koryta-pl-crawled koryta-pl-sharedcache; do
  gcloud storage buckets add-iam-policy-binding gs://$bucket \
    --member=serviceAccount:$SA --role=roles/storage.objectCreator
done

# The capture extractor's Dockerfile, under the jobs' own tag, so rebuilding
# one does not move the other.
gcloud builds submit data/pipelines --tag=$IMAGE --project=$PROJECT

# USERNAME names the job's pipeline backups (user=krs-jobs) and, having none of
# its own at first, makes it restore the newest anyone wrote. TZ keeps the
# pipelines' naive dates on the Warsaw day, as on the laptops they were written
# on. 8Gi: a 4.5 GB peak, and a container's disk is memory too.
gcloud run jobs create krs-scrape-free --project=$PROJECT --region=$REGION \
  --image=$IMAGE --service-account=$SA \
  --command=koryta_scrape_krs_free --args=--max-minutes=170 \
  --set-env-vars=USERNAME=krs-jobs,TZ=Europe/Warsaw \
  --cpu=2 --memory=8Gi --task-timeout=3h --max-retries=0

# Once by hand first. Nothing has asked api-krs from Google's addresses yet;
# if it refuses them, 20 failed requests in a row end the run with 75 and the
# summary's `errors` say what came back.
gcloud run jobs execute krs-scrape-free --project=$PROJECT --region=$REGION --wait
gcloud storage cat "gs://koryta-pl-sharedcache/jobs/krs_scrape_free/runs/date=$(TZ=Europe/Warsaw date +%F)/*.json"

# Then every night. The scheduler calls the Cloud Run API as the job's own
# account, which needs the invoker role on the job and nothing more.
gcloud run jobs add-iam-policy-binding krs-scrape-free --project=$PROJECT \
  --region=$REGION --member=serviceAccount:$SA --role=roles/run.invoker
gcloud scheduler jobs create http krs-scrape-free-nightly --project=$PROJECT \
  --location=$REGION --schedule="30 0 * * *" --time-zone=Europe/Warsaw \
  --uri="https://run.googleapis.com/v2/projects/$PROJECT/locations/$REGION/jobs/krs-scrape-free:run" \
  --http-method=POST --oauth-service-account-email=$SA
```

After a change to the job, rebuild the image and point the job at it:

```bash
gcloud builds submit data/pipelines --tag=$IMAGE --project=$PROJECT
gcloud run jobs update krs-scrape-free --project=$PROJECT --region=$REGION --image=$IMAGE
```

Do not execute it by hand between 00:30 and 03:30: two runs ask api-krs twice
as often, and nothing stops the second.
