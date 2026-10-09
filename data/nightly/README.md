# The night on one VM

Every night one small VM in `koryta-pl` boots, runs everything that keeps the
data current, and switches itself off. It runs after the site's 04:00 export,
when nobody is still editing, and compares tonight's people with that copy:

| Warsaw time | What                                                                                                   |
| ----------- | ------------------------------------------------------------------------------------------------------ |
| 04:00       | `scheduledFirestoreExport` copies the site to `gs://koryta-pl-crawled/hostname=koryta.pl/date=<UTC>/` |
| 04:15       | the instance schedule boots `koryta-nightly` (up to 15 minutes late, the docs say)                     |
| 04:30       | `koryta-nightly.timer` starts `koryta-nightly.service`: `night.sh`, then `koryta_nightly`              |
| ~06:30      | the night is over; `poweroff.sh` switches the VM off                                                   |
| 08:30       | `--stop-by`: no step but `compress` and `tidy` starts after this                                       |
| 09:00       | the instance schedule stops the VM, if a night hung                                                    |

`night.sh` brings the checkout up to `KORYTA_REF` (`origin/main` by default),
syncs the venv, builds the compressor, reads the secrets, and hands over to
`koryta_nightly` (`data/pipelines/src/jobs/nightly`), which runs the steps in
order, each with a time limit and its output in the night's log:

| Step         | What                                                                                                                  |
| ------------ | --------------------------------------------------------------------------------------------------------------------- |
| `compress`   | the compressor, `-incremental -hostname` for rejestr.io, then api-krs.ms.gov.pl: the whole previous day in UTC          |
| `export`     | waits for tonight's export: the newest one with its `.overall_export_metadata`, taken at most 6 h before the night     |
| `krs_free`   | `koryta_scrape_krs_free --max-minutes 60`: the bulletin, then api-krs                                                  |
| `krs_odpis`  | `koryta_krs_odpis --graph --changed-since <yesterday> --max 300`: odpisy pełne of the companies the bulletin named      |
| `krs_paid`   | `koryta_scrape_krs_paid --scope fallback --max-calls 50`: rejestr.io for what the free sources could not give           |
| `reprocess`  | `koryta --all-pipelines --refresh all`, as the CI nightly, less the article branch and the slow static sources (`HELD`) |
| `tests`      | `pytest src/tests/pipelines` over the night's outputs                                                                  |
| `outputs`    | `pytest -m e2e src/tests/e2e`: the outputs against `baseline.json`                                                     |
| `invariants` | `pytest -m e2e src/tests/pipelines`: the database invariants, over tonight's export                                    |
| `people`     | `koryta_people_import --scope priority --max-uploads 100 --refresh none`                                               |
| `scores`     | `koryta_score_import`: the scoring models rebuilt, tonight's new pages included, and their votes reconciled            |
| `tidy`       | export shards and day-named outputs older than a week off the disk                                                     |

The VM keeps its disk, so `versioned/`, the download cache, the listing ranges
and the odpis parse memo carry over from one night to the next: the jobs run
the warm path they were measured on, on predator, rather than a cold container
fetching everything again.

## What the night buys

rejestr.io charges 0.05 PLN a call, so the night buys only what the free
sources cannot give (`--scope fallback`), before the rebuild, so that what it
buys reaches the same night's people - who send those pages first, right after
the new hires:

- the person feeds of the people somebody marked interesting - a vote on the
  site, or the hardcoded list - which no register says. A vote buys the entry
  its page links; a page without a link is matched by name, namesakes and all;
- the connections of a company whose odpis pełny `krs_odpis` asked for and did
  not get: the gateway or the network ate it twice, or the service answered
  with something the job could not take (`KrsOdpisAttempts`, the fold of the
  odpis job's run record). A company it has not asked about yet waits for it.

At most 50 calls a day (`--paid-max-calls`): what the crawl bucket already
holds from rejestr.io that day counts against it, so a night run twice buys no
more than once. People first, then public companies. What the cap leaves waits
for the next night, which reads as "partial". A refused account - a key
rejestr.io does not take, no credit left - fails the step; nothing waits on it,
so the people go up either way. The step reads the key from Secret Manager
itself (`rejestr-io-key`) and gives it to the paid job alone; without it the
step is skipped, and the night's log says why.

## What the night uploads, and what holds it back

Pipeline outputs: every one the reprocess rebuilds goes to the shared cache as
`user=main` (`USERNAME` in `/etc/koryta/nightly.env`). A restore anywhere now
prefers the newest of the restoring user's own backups and `main`'s
(`stores.storage.MAIN_USER`), so a machine that built something last week takes
this morning's copy.

People: at most 100 a night (`--max-uploads`), in this order
(`analysis/payloads/priority.py`):

1. somebody the site has no page for, with a public post that began in the
   last 30 days and has not ended - the page is created unpublished, so they
   reach the review queue, not the site;
2. a page the payload would change, of somebody whose rejestr.io feed was
   bought in the last 7 days (`--bought-days`) - by `krs_paid` or by hand, as
   the crawl bucket's names say - so what was paid for reaches the site that
   night, or the night after a hand run or a held night. A page only: the
   feeds are bought by name, so a bought entry without a page is most likely
   a namesake's, and nobody but a new hire gets a page;
3. a page the payload would change, on which somebody noted that data is
   missing ("Brakuje danych") and no admin has closed the entry - on the page
   itself, or on the page of a company the payload names: the night sends no
   company payloads, so what a company lacks comes up as its people's posts;
4. the same for any other note entry still open: a correction ("Do poprawy"),
   or an entry an admin marked unresolved;
5. a published page the payload would change;
6. any other page the payload would change.

Newest news first inside each. A payload sent unchanged in the last 30 days
is left alone (`--resend-after`), so a pending update or a party a human took
off a page does not take a slot every night - and is not put back every night.
That keeps the second tier to the week's purchases not yet sent: a bought
person whose payload went up unchanged is left alone like anybody else. And a
note nobody closes puts its page first only when there is something new to
send it.

Scores: after the people, every scoring model (`analysis/scores`) is rebuilt
and its shortlist reconciled with the votes it holds on the site - a changed
score written, one it no longer gives taken back (`koryta_score_import`). The
models rate the site's people as the 04:00 export has them and the pages the
people step has just created (`scrapers/koryta/created.py`, read from what the
import says it sent), so a new hire is in the queue on /eksploruj/nowe the same
morning rather than after the next export. A model that rates nobody is not
uploaded: reconciled, it would take back every vote it has.

A failed step does not end the night; the steps that depend on it are held:

- `invariants` needs the export; `tests` and `outputs` the reprocess.
- `people` needs tonight's export, a reprocess that succeeded, and checks with
  nothing new failing. "New" is against the last night that ran the check: a
  test that passed then and fails now - most likely after the last upload -
  holds the upload until somebody looks. The first night's failures are its
  baseline; on 2026-10-03, 18 invariants failed on budgets that had drifted
  past their measured values.
- `scores` needs the same, but not the people: however they went, the scores
  go up, with whatever pages the people step did create.

## Runs asked for on the site

The datascience group can ask, from a company's page or a person's, for what
the pipelines know about it to be sent now ("Wyślij dane osób",
"Wyślij dane tej osoby"). The site queues a run - a `jobRuns` document in the
ops database, `queued`, with the request in it - hands back its link,
`/admin/procesy#przebieg-<id>`, and starts this VM (`JOB_RUNNER_DISPATCH=vm`).
At every boot `koryta-requests.service` (`requests.sh`) runs
`koryta_job_requests --watch`, which:

- claims the queued runs one at a time, oldest first, and runs each as
  `koryta_people_import --request <id> --refresh none` - the night's outputs as
  they are on disk, the code the last night checked out. A company's run sends
  its people (pages for those the site lacks are created unpublished), a
  person's run that one person (it never creates a page);
- takes `/var/lib/koryta-nightly/lock` for each run, as `night.sh` does for a
  night: a run waits for a night to finish, and a night started during a run
  waits for it (up to `KORYTA_LOCK_WAIT`, 30 min) instead of giving up;
- holds `requests.busy` while it has a run in hand, so the night's
  `poweroff.sh` leaves the VM up (as it does while one is queued) and the
  worker switches it off itself;
- once it has run something and nothing more comes for 10 minutes, writes
  `poweroff-requested` and exits, and `poweroff.sh requests` switches the VM
  off - never between 03:45 and 04:45 (the night is about to start), never
  while somebody is logged in or a night holds the lock, never with
  `/etc/koryta/stay-up`. A VM booted by hand, where it has run nothing, stays
  up as before;
- ends a run its job could not end (a crash, the ops database out of reach) by
  the job's exit code, and at start a run this host was doing when it went down.

Until the site may start the VM (task `grant-site-starts-nightly-vm`), a
request waits for the next night: the 04:15 boot starts the worker too, which
runs the queue once the night lets go of the lock.

By hand on the VM: `journalctl -u koryta-requests -f`;
`sudo systemctl stop koryta-requests` keeps it from claiming anything.
`KORYTA_REQUESTS_ARGS` in `/etc/koryta/nightly.env` passes flags, e.g.
`--idle-minutes 30`.

## Setting it up

Once, as the project owner. `dev-workflow` cannot: it gets 403 on IAM, Compute
and Secret Manager.

1. Create the service account, its grants, the secrets, the VM and its
   schedule. Each step checks first, so a rerun carries on:

   ```bash
   bash data/nightly/create-vm.sh
   ```

   The PESEL key is added from the machine that holds it
   (`~/.config/koryta/pesel-salt`); the script says how if it is not that one.
   An existing secret is kept as it is: never add it a second version, as a
   new key's fingerprints join to nothing. The rejestr.io key comes from
   `REJESTR_KEY` (`REJESTR_KEY=... bash data/nightly/create-vm.sh`); without
   it the script prints the command that adds it later, and until then the
   night buys nothing. A new rejestr.io key can simply be added as a new
   version.

2. Prepare the VM - packages, the `koryta` user, uv, Go, the checkout, the
   units:

   ```bash
   gcloud compute ssh koryta-nightly --zone=europe-central2-b --project=koryta-pl \
     --command='sudo bash -s' < data/nightly/setup-vm.sh
   ```

   It sets up from `origin/main`. Before this is merged, name the branch -
   `--command='sudo env KORYTA_REF=origin/nightly-vm bash -s'` - and the
   nights run the branch until `KORYTA_REF` in `/etc/koryta/nightly.env` goes
   back to `origin/main`. Change it when the branch merges: once it is deleted,
   a night cannot check it out and stops at the start.

3. Run the first night by hand, sending nobody. It is a cold one - empty
   `versioned/`, empty download cache - so it takes longer than the rest.
   `--export-max-age 24` lets a daytime run take this morning's 04:00 export
   as tonight's. Only one taken within 6 h of the start counts otherwise, so
   a run started after 10:00 would wait 90 minutes for an export that comes
   tomorrow and then hold the people step:

   ```bash
   gcloud compute ssh koryta-nightly --zone=europe-central2-b --project=koryta-pl
   sudo systemd-run --unit=koryta-nightly-manual --uid=koryta --gid=koryta \
     --property=EnvironmentFile=/etc/koryta/nightly.env \
     --property=StateDirectory=koryta-nightly \
     /home/koryta/koryta/data/nightly/night.sh --force --people-dry-run \
       --export-max-age 24
   journalctl -u koryta-nightly-manual -f   # Ctrl-C leaves the night running
   ```

   The run is a service of its own, as the scheduled night is: a dropped SSH
   connection does not end it. (Not `--pty`: a hangup on its terminal would
   kill the night, which handles only SIGTERM.) To start it again after it
   ended, `sudo systemctl reset-failed koryta-nightly-manual` first.

   Then read the summary, and the log for the people step's plan
   ("Planned by tier", "The first 100 by tier"):

   ```bash
   gcloud storage cat "gs://koryta-pl-sharedcache/jobs/nightly/runs/date=$(TZ=Europe/Warsaw date +%F)/*.json"
   ```

4. The nights send up to 100 people from the start (`--max-uploads`). For
   nights that build and count them and send none, put
   `KORYTA_NIGHTLY_ARGS=--people-dry-run` in `/etc/koryta/nightly.env`.

Stop the VM afterwards, or leave it: the schedule boots it at 04:15 either
way, and the timer runs the night on a VM that is already up too.

## Day to day

- **How did last night go?** The row "Noc na maszynie koryta-nightly" on
  `/admin/procesy`; the jobs it ran report under their own names. The summary
  and the whole log are in `gs://koryta-pl-sharedcache/jobs/nightly/runs/` and
  `.../logs/`.
- **Log in during a night.** `sudo touch /etc/koryta/stay-up` before 04:30 and
  the VM stays up afterwards; remove it, or the VM runs - and bills - until
  the schedule's 09:00 stop. A boot outside the night window runs no night -
  only the requests worker, which does what is queued (above).
- **One step by hand.** `night.sh --force --only people --people-dry-run`
  (the `systemd-run` line above). Steps left out by `--only` or `--skip` hold
  nothing back. A real people run by hand creates pages no model has rated:
  add `--only scores`, or they wait for the next night.
- **Other code.** `KORYTA_REF` in `/etc/koryta/nightly.env` - a tag holds the
  VM still while `main` moves. Every merge to `main` is otherwise live the
  next night.
- **More people.** `KORYTA_NIGHTLY_ARGS=--max-uploads 300`.
- **More, or nothing, from rejestr.io.** `KORYTA_NIGHTLY_ARGS=--paid-max-calls 100`,
  or `0`. What a night bought is in
  `gs://koryta-pl-sharedcache/jobs/krs_scrape_paid/runs/`; what it would buy,
  without buying, `koryta_scrape_krs_paid --scope fallback --max-calls 50 --dry-run`.
- **A changed unit or timer.** Run `setup-vm.sh` again: systemd reads its own
  copies, not the checkout's.
- **Something broken in `versioned/`.** Delete the output; the next night
  restores it from the shared cache or rebuilds it.

## What it costs

At list prices in europe-central2: the VM, e2-highmem-4, is $0.218 an hour.
The first full night (2026-10-05, caches warm) took 110 minutes - 67 of them
the rebuild, 27 the pipeline tests - and peaked at 17.6 GB, so with the boot
about $13 a month. Its 30 GB balanced disk is $3.90 a month whether it runs
or not. Bucket traffic is under a dollar. The
shared cache grows by the night's backups as `main`; how long it keeps them is
`decide-sharedcache-backup-retention`. rejestr.io is at most 50 calls a night,
2.50 PLN; the first night's plan, on 2026-10-06's queue, was 12 calls.

## What it does not do

- rejestr.io for a company the free odpis has not been asked about: the
  night's `krs_odpis` asks only the companies the bulletin named since
  yesterday, so one that is new to the queue waits for a hand run of
  `koryta_krs_odpis`, which asks the queue's.
- Companies: `CompaniesPayloads --only-changed` is not sent; a person's missing
  company is created on the way, as the uploader always did.
- `test_rejestrio_coverage.py`: it walks the whole rejestr.io prefix twice, an
  hour and a half - by hand only, as in CI.
- The article crawl.

## Files

| File                      | What                                                                            |
| ------------------------- | ------------------------------------------------------------------------------- |
| `create-vm.sh`            | the GCP side, once: service account, grants, secrets, VM, schedule              |
| `setup-vm.sh`             | the VM side, idempotent: packages, user, uv, Go, checkout, `/etc/koryta`, units |
| `koryta-nightly.timer`    | 04:30 Warsaw; catches up a missed start after boot                              |
| `koryta-nightly.service`  | runs `night.sh` as `koryta`, then `poweroff.sh` as root                         |
| `night.sh`                | night window, lock, checkout, venv, compressor, secrets, then `koryta_nightly`  |
| `koryta-requests.service` | at every boot: `requests.sh`, the worker for runs asked for on the site         |
| `requests.sh`             | the web key, then `koryta_job_requests --watch`                                 |
| `poweroff.sh`             | powers off after a night or an idle worker, unless `/etc/koryta/stay-up`        |
| `nightly.env.example`     | `/etc/koryta/nightly.env`'s first version                                       |
