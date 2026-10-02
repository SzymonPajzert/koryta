# List of currently defined jobs

## krs_scrape_bulletin
1. Reads KRS bulletin for updates on dates we haven't scraped yet

## krs_scrape_free
1. Runs krs_scrape_bulletin
1. Reprocesses pipelines, reads `ScrapeRejestrIO`, which lists what is worth asking about
1. Asks api-krs for each free URLs that we defined for the given KRS
1. Writes every answer to the crawl bucket - an empty object where there was none
1. Writes a run summary to the shared cache (`jobs/krs_scrape_free/runs/`)

Runs nightly on Cloud Run, between midnight and the Firestore export - see [CLOUD_RUN.md](CLOUD_RUN.md).

## krs_scrape_paid
1. Reads which KRS numbers need to be updated
1. Performs paid queries to rejestr.io

A company's connections are not bought where `PeopleKRSCombined` already takes its people from an odpis pełny that
the bulletin names no entry after: `krs_odpis` gets those for free. So run `krs_odpis` first, then
`koryta PeopleKRSCombined --refresh KrsOdpisSeats --refresh KrsOdpisEntries`, then this.

TODO: to be used only for people queries, since we've found free KRS scraping alternatives

## krs_register_owners
1. Reads output of `KRSRegisterEntries` pipeline
1. Continues crawl of the api-krs endpoint to find owners of the companies
1. Writes on failure or partial flushes to RESPONSE_LOG (sharedcache bucket, job output)

## krs_odpis
1. Reads the company part of `ScrapeRejestrIO` (person feeds stay paid), KRS numbers from `--krs-file`, or every company `CompaniesKRS` knows (`--graph`)
1. With `--changed-since DAY`, keeps only the companies the bulletin (`KRSUpdates`) names on or after that day - the weekly refresh
1. Skips companies whose odpis pełny is on file, unless the bulletin names the entry since
1. Asks the ministry's public KRS search service for each odpis pełny, politely, stopping when the service tires
1. Writes every PDF to the crawl bucket, and a record of every attempt to the shared cache (`jobs/krs_odpis/runs/`)

Then `KrsOdpisSeats` and `KrsOdpisEntries` read the PDFs into dated seats and each company's register entries -
the company history `krs_scrape_paid` buys from rejestr.io - and `PeopleKRSCombined` puts the seats in place of
rejestr.io's for every company where the odpis is the newer of the two, on the way to `PeopleMerged`.

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
| `KORYTA_JOB_TRIGGER`            | `schedule`, `manual` or `event`. Without it a Cloud Run execution counts as Cloud Scheduler's and anything else as a hand run.                                                                                |
| `KORYTA_JOB_STATUS_IMPERSONATE` | A service account to write as. On predator `ops-writer@koryta-pl.iam.gserviceaccount.com`: dev-workflow may impersonate it, and it may write `agent-tasks` - all of it, the task list too - and nothing else. |
| `KORYTA_VERSION`                | The code version recorded on the run. The Cloud Run jobs are given it at deploy time (CLOUD_RUN.md); without it only a Cloud Run service has one, `K_REVISION`, and a job's runs have none.                   |

`FIRESTORE_EMULATOR_HOST` sends the writes to the emulator, anonymously, under
the project `GOOGLE_CLOUD_PROJECT` or `GCLOUD_PROJECT` names, else
`demo-koryta-pl` - the one the dev stack starts its emulators under, and so the
one the local /admin/procesy reads.

What reports: `krs_scrape_free` (not `--dry-run`), `krs_scrape_paid` (once the
bill is accepted), `krs_odpis` (not `--dry-run`), `krs_register_owners` (not
`--dry-run` or `--reads 0`) and the article crawl, `koryta_crawl`. A job the
page's registry (`JOBS` in `frontend/shared/jobs.ts`) does not list still shows,
under "Inne".
