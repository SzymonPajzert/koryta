# List of currently defined jobs

## krs_scrape_bulletin
1. Reads KRS bulletin for updates on dates we haven't scraped yet

## krs_scrape_free
1. Runs krs_scrape_bulletin
1. Reprocesses pipelines, reads `ScrapeRejestrIO`, which lists what is worth asking about
1. Asks api-krs for each free URLs that we defined for the given KRS
1. Writes every answer to the crawl bucket - an empty object where there was none
1. Writes a run summary to the shared cache (`jobs/krs_scrape_free/runs/`)

Runs nightly as a step of the night on the koryta-nightly VM, after the 04:00 Firestore export - see [data/nightly/README.md](../../../nightly/README.md).

## krs_scrape_paid
1. Reads which KRS numbers need to be updated
1. Performs paid queries to rejestr.io

A company's connections are not bought where `PeopleKRSCombined` already takes its people from an odpis pełny that
the bulletin names no entry after: `krs_odpis` gets those for free. So run `krs_odpis` first, then
`koryta PeopleKRSCombined --refresh KrsOdpisSeats --refresh KrsOdpisEntries`, then this.

By hand it buys the whole queue, after Enter and a question before each call. At night it runs as
`--scope fallback --max-calls 50`: only what the free sources cannot give - the person feeds of the people somebody
marked interesting, and the connections of the companies whose odpis pełny `krs_odpis` asked for and did not get
(`KrsOdpisAttempts`, the fold of its run record) - people first, then public companies, at most 50 calls a day. What
the crawl bucket already holds from rejestr.io that day counts against the cap, so it is the day's, not the run's.
It asks nothing, stops at once when rejestr.io refuses the account (exit 1), leaves what the cap or a failed call
left for the next run (exit 75), and writes a run summary to the shared cache (`jobs/krs_scrape_paid/runs/`).

## krs_register_owners
1. Rebuilds `KRSRegisterQueue` from the bulletin (`KRSUpdates`) and the fold of its own log (`KRSRegisterEntries`): the numbers registered since the log began that have no answer yet, then failed reads, then answers the register has moved on from, then the numbers never read, oldest first
1. Asks api-krs for the odpis aktualny of each: with `--new-registrations` every new registration, then `--reads N` more; without it, `--reads N` from the head
1. Appends every answer, verbatim, to its log as write-once parts (`jobs/krs_register_owners/responses/` in the shared cache), flushing as it goes
1. Stops after the read in hand at `--max-minutes` (exit 75), on SIGTERM or Ctrl+C, or after 20 failures in a row (exit 75, reported as failed)

`CompaniesPublicByRegister` picks the publicly owned companies out of the fold, and `ScrapeRejestrIO` queues them for
the free scrape (`public_owner`). Runs nightly as the step `krs_register`, after `krs_scrape_free` has fetched the
day's bulletin: `--new-registrations --reads 0`, the backlog's pace waiting on `decide-register-sweep-pace` - see
[data/nightly/README.md](../../../nightly/README.md).

## krs_odpis
1. Reads the company part of `ScrapeRejestrIO` (person feeds stay paid), KRS numbers from `--krs-file`, or every company `CompaniesKRS` knows (`--graph`)
1. With `--changed-since DAY`, keeps only the companies the bulletin (`KRSUpdates`) names on or after that day - the weekly refresh
1. With `--missing public` (and `--graph`), then adds the graph's public companies with no odpis pełny on file, which the bulletin may never name again; `--missing all` the private ones after them. Live before struck off (`CompaniesKRS`'s `struck_off`), and within those never asked before last unanswered (`KrsOdpisAttempts`); one the service said is in neither register is left out. `--max` caps them all together
1. Skips companies whose odpis pełny is on file, unless the bulletin names the entry since
1. Asks the ministry's public KRS search service for each odpis pełny, politely, stopping when the service tires
1. Writes every PDF to the crawl bucket, and a record of every attempt to the shared cache (`jobs/krs_odpis/runs/`)

Then `KrsOdpisSeats` and `KrsOdpisEntries` read the PDFs into dated seats and each company's register entries -
the company history `krs_scrape_paid` buys from rejestr.io - and `PeopleKRSCombined` puts the seats in place of
rejestr.io's for every company where the odpis is the newer of the two, on the way to `PeopleMerged`.

## nightly
1. Runs the night on the koryta-nightly VM, one step after another: the compressor, then waits for tonight's 04:00 export, then `krs_scrape_free`, `krs_register_owners --new-registrations`, `krs_odpis --missing public`, `krs_scrape_paid --scope fallback --max-calls 50`, every pipeline rebuilt (backed up as `main`), the pipeline tests, the output checks, the invariants, `people_import --scope priority --max-uploads 100` and `score_import`
1. A step that fails holds only the steps that depend on it; the people and the scores wait for tonight's export, a reprocess that succeeded and checks with nothing newly failing
1. Writes its summary to the shared cache (`jobs/nightly/runs/`) and its log beside it (`jobs/nightly/logs/`)

Started by a systemd timer on the VM at 04:30, after the export - see [data/nightly/README.md](../../../nightly/README.md).

## people_import
1. Rebuilds the people from the newest crawl and this morning's export: `PeopleKRS` (rejestr.io), `KrsOdpisSeats` and `KrsOdpisEntries` (the odpisy), `CompaniesKRS`, `KorytaPeople`, and every pipeline between them and the payloads (`DEFAULT_REFRESH` says why each; `--refresh` names others in their place)
1. Builds the payloads `koryta PeoplePayloads --all --on-koryta --only-changed` would print - the people the site has whose page would change; `--scope not-on-koryta` the people it has not; `--scope priority` both, ordered for a capped run: new hires at public companies first (those only an odpis names, with no rejestr.io entry, at most a tenth of the run: `--max-new-odpis-only`), then the pages of the people whose rejestr.io feed was bought in the last week (`--bought-days`), then the pages with a note no admin has closed (`KorytaNotes`) - on the page, or on a company the payload names - those saying data is missing first, then published pages, then the rest, leaving out what it sent unchanged in the last 30 days
1. Writes them to the shared cache as one write-once part (`jobs/people_import/payloads/date=<day>/<run>.jsonl.gz`), so what any day sent can be read back without diffing two exports
1. Sends them to `/api/ingest/person` one by one, at the uploader's pace, first creating any company a person names that the site has no page for
1. Writes a run summary to the shared cache (`jobs/people_import/runs/`)

It stops at once as failed (exit 1) on what means the site is not taking what it should: more pages created than
`--max-new` allows - none by default, since a page an `--on-koryta` run creates is somebody the identity lookup
missed, which is how 105 namesake pages appeared on 2026-09-12 - or 20 requests in a row refused. It stops as
partial (exit 75), leaving the rest to the next day, whose `--only-changed` still finds it changed: after
`--max-uploads` (3000), at `--max-minutes` (120, the build included), on SIGTERM once the person in hand is done,
and on Ctrl+C. Some people refused is partial too; every one of them, failed.

Before it goes live it runs a week with `--dry-run`: it builds the payloads, sends nothing, writes nothing of its
own, and reports the run as succeeded with `planned` and the stop reason "próba - nic nie wysłano", so
/admin/procesy shows what each day would have sent. Then live, with `--max-uploads` - see [CLOUD_RUN.md](CLOUD_RUN.md).

`--request <run id>` does what somebody asked for on a page of the site: a company's people, or one person
(`analysis/payloads/target.py`). It reads the request from the run the site queued, builds both halves as `priority`
does and keeps to their guards - a company's run creates pages for the company's people the site lacks and no one
else, a person's run creates none - and reports as `people_request` on that same run. `koryta_job_requests` starts it.

Every `koryta_uploader --submit` run reports now too: `--type person` as `people_import`, the same job, so a hand
upload and the daily one read as one history; `company` as `company_import`, `score` as `score_import`,
`extraction` as `extraction_import`. A preview without `--submit` reports nothing, and nor does `computeNodes`.

The import and the uploader sign in the same way (`stores.koryta_login`), the first that is set winning. A 401
renews the token once and sends the request again; a token that cannot be renewed fails that payload.

| Variable               | What it does                                                                                                                                                                                                                                                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `KORYTA_ID_TOKEN`      | A Firebase id token, sent as it is. It lasts an hour and cannot be renewed - for the emulator or a short hand run.                                                                                                                                                                                                        |
| `KORYTA_PIPELINE_UID`  | Sign in as this robot: the run's service account mints a custom token for the uid with the `datascience` claim and exchanges it for an id token, again before each hour is up. Has to contain `pipeline`, which is what the site counts as automated rather than somebody's work. In production `pipeline-people-import`. |
| `FIREBASE_WEB_API_KEY` | The web key that exchange needs, the one in `frontend/nuxt.config.ts`. Required with `KORYTA_PIPELINE_UID`.                                                                                                                                                                                                               |

With neither of the first two set, whoever runs it signs in through the browser, as before, and again when the
site answers 401.

## score_import
1. Rebuilds every scoring model (`analysis.scores`) over what is on disk - on the VM, what the night's reprocess has just built - rating the site's people as this morning's export has them, and the pages the people import created since: `KorytaPeopleCreated` folds them from its `sent/` parts, which name the page each person went to
1. Reconciles each model's votes on the site with what it wrote last time (`util.firestore.Firestore.replace_scores`): a changed score is written, one it no longer gives taken back; a model that rates nobody is not uploaded, since reconciled it would take back every vote it has, and fails the run
1. Writes a run summary to the shared cache (`jobs/score_import/runs/`): each model's counts, and how many of the pages created since the export some model rated

Runs nightly as the step after the people on the koryta-nightly VM, so a new hire's page has its score the morning it is created - see [data/nightly/README.md](../../../nightly/README.md). `submit_scores.sh` uploads the same models by hand, one `koryta_uploader --type score` per model. After an export taken by hand later the same day, `--refresh KorytaPeople --refresh KorytaVotes --refresh KorytaFacts --refresh CompanyScores` makes the models read it: the site's people are read through day-named outputs, which still hold the morning's.

## requests
1. Takes the runs the datascience group queued from the site's pages ("Wyślij dane osób", "Wyślij dane tej osoby"), oldest first, claiming each so that no run is done twice
1. Runs each as `koryta_people_import --request <id> --refresh none`, under the night's lock
1. Ends a run whose job could not say how it ended, by the job's exit code
1. `--watch`: once it has run something and nothing more comes for ten minutes, asks for the VM to be switched off

Started at every boot of the koryta-nightly VM, which the site starts for a request - see [data/nightly/README.md](../../../nightly/README.md).
By hand, against the emulator or wherever there are outputs to read: `koryta_job_requests --once`.

# Reporting a run

The jobs report their runs to [koryta.pl/admin/procesy](https://koryta.pl/admin/procesy)
(owner only): whether it is going, how far it has got, how it ended - and, for a
scheduled job, that it never started, which nothing else would show. The page's
rules are `frontend/shared/jobs.ts`; the writer is `stores.job_runs.JobRun`, and
it writes two kinds of document to the ops Firestore database `agent-tasks`,
next to the task list (`tasks`):

- `jobRuns/{runId}`, one per run: state (`running`, then `succeeded`, `partial`
  or `failed`), trigger, host, start, last heartbeat, finish, progress (`done`
  of `total` in `unit`), counters, phase, why it stopped, the first 20 errors,
  exit code, the run summary's `gs://` path, code version.
- `jobs/{jobId}`, one per job: its newest run, when it last ran on its schedule
  (`lastScheduledAt`) and when it last succeeded (`lastSucceededAt`). The page
  calls a scheduled job late only once it has run on its schedule at least once.

`partial` means the run stopped cleanly with work left - a deadline, SIGTERM, a
backlog bigger than one night - and the next run carries on; `failed` is a crash
or an upstream refusing. Exit 75 means either, so the job decides, not the code.

Reporting never fails a job. A write that does not land is printed once and then
only counted, and three in a row switch reporting off for the rest of the run,
since each one held the job up for its 10 s timeout. Credentials that cannot give
a token switch it off before the first write. A job with no access to the ops
database runs exactly as before, and writes are throttled to one a minute however
often a job reports.

The access is wider than the job runs. IAM narrows Firestore to a database, not
a collection, so an account that may report runs may write - and delete - any
document in `agent-tasks`, the task list included. That is the reach ops-writer
already has, and the Cloud Run jobs' account gets the same (CLOUD_RUN.md). A
database of the job runs' own would take the task list out of it; none has been
made.

| Variable                        | What it does                                                                                                                                                                                                  |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `KORYTA_JOB_STATUS`             | `0` (or `off`, `false`, `no`) writes nothing. Under pytest nothing is written unless a test passes in its own client.                                                                                         |
| `KORYTA_JOB_TRIGGER`            | `schedule`, `manual`, `event` or `request`. Without it a Cloud Run execution counts as Cloud Scheduler's and anything else as a hand run.                                                                     |
| `KORYTA_JOB_STATUS_IMPERSONATE` | A service account to write as. On predator `ops-writer@koryta-pl.iam.gserviceaccount.com`: dev-workflow may impersonate it, and it may write `agent-tasks` - all of it, the task list too - and nothing else. |
| `KORYTA_VERSION`                | The code version recorded on the run. The Cloud Run jobs are given it at deploy time (CLOUD_RUN.md); without it only a Cloud Run service has one, `K_REVISION`, and a job's runs have none.                   |

`FIRESTORE_EMULATOR_HOST` sends the writes to the emulator, anonymously, under
the project `GOOGLE_CLOUD_PROJECT` or `GCLOUD_PROJECT` names, else
`demo-koryta-pl` - the one the dev stack starts its emulators under, and so the
one the local /admin/procesy reads.

A run somebody asks for on a page starts as a document the site writes: `jobRuns/{runId}` in state `queued`, with
the request under `request` (`stores.job_requests`, `frontend/server/utils/jobRequests.ts`). The job that takes it on
reports on that same document - `JobRun(..., adopt=True)` fills it in rather than replacing it - so the link the site
handed out, `/admin/procesy#przebieg-<runId>`, follows the run from the click to its end.

What reports: `krs_scrape_free` (not `--dry-run`), `score_import` (not `--dry-run`), `krs_scrape_paid` (once the
bill is accepted; with `--max-calls`, every run but `--dry-run`, a run with
nothing to buy too), `krs_odpis` (not `--dry-run`), `krs_register_owners` (not
`--dry-run`, nor `--reads 0` without `--new-registrations`), the article crawl, `koryta_crawl`, `people_import`
(a `--dry-run` too) and `koryta_uploader --submit`, under `people_import`,
`company_import`, `score_import` or `extraction_import` by `--type` (not
`computeNodes`). A job the page's registry (`JOBS` in `frontend/shared/jobs.ts`)
does not list still shows, under "Inne".
