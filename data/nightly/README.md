# The night on one VM

Every night one small VM in `koryta-pl` boots, runs everything that keeps the
data current, and switches itself off. It runs after the site's 04:00 export,
when nobody is still editing, and compares tonight's people with that copy:

| Warsaw time | What                                                                                                   |
| ----------- | ------------------------------------------------------------------------------------------------------ |
| 04:00       | `scheduledFirestoreExport` copies the site to `gs://koryta-pl-crawled/hostname=koryta.pl/date=<UTC>/` |
| 04:15       | the instance schedule boots `koryta-nightly` (up to 15 minutes late, the docs say)                     |
| 04:30       | `koryta-nightly.timer` starts `koryta-nightly.service`: `night.sh`, then `koryta_nightly`              |
| ~06:00      | the night is over; `poweroff.sh` switches the VM off                                                   |
| 08:30       | `--stop-by`: no step but `compress` and `tidy` starts after this                                       |
| 09:00       | the instance schedule stops the VM, if a night hung                                                    |

`night.sh` brings the checkout up to `KORYTA_REF` (`origin/main` by default),
syncs the venv, builds the compressor, reads the two secrets, and hands over to
`koryta_nightly` (`data/pipelines/src/jobs/nightly`), which runs the steps in
order, each with a time limit and its output in the night's log:

| Step         | What                                                                                                                  |
| ------------ | --------------------------------------------------------------------------------------------------------------------- |
| `compress`   | the compressor, `-incremental -hostname` for rejestr.io, then api-krs.ms.gov.pl: the whole previous day in UTC          |
| `export`     | waits for tonight's export: the newest one with its `.overall_export_metadata`, taken at most 6 h before the night     |
| `krs_free`   | `koryta_scrape_krs_free --max-minutes 60`: the bulletin, then api-krs                                                  |
| `krs_odpis`  | `koryta_krs_odpis --graph --changed-since <yesterday> --max 300`: odpisy pełne of the companies the bulletin named      |
| `reprocess`  | `koryta --all-pipelines --refresh all`, as the CI nightly, less the article branch and the slow static sources (`HELD`) |
| `tests`      | `pytest src/tests/pipelines` over the night's outputs                                                                  |
| `outputs`    | `pytest -m e2e src/tests/e2e`: the outputs against `baseline.json`                                                     |
| `invariants` | `pytest -m e2e src/tests/pipelines`: the database invariants, over tonight's export                                    |
| `people`     | `koryta_people_import --scope priority --max-uploads 100 --refresh none`                                               |
| `tidy`       | export shards and day-named outputs older than a week off the disk                                                     |

The VM keeps its disk, so `versioned/`, the download cache, the listing ranges
and the odpis parse memo carry over from one night to the next: the jobs run
the warm path they were measured on, on predator, rather than a cold container
fetching everything again.

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
2. a published page the payload would change;
3. any other page the payload would change.

Newest news first inside each. A payload sent unchanged in the last 30 days
is left alone (`--resend-after`), so a pending update or a party a human took
off a page does not take a slot every night - and is not put back every night.

A failed step does not end the night; the steps that depend on it are held:

- `invariants` needs the export; `tests` and `outputs` the reprocess.
- `people` needs tonight's export, a reprocess that succeeded, and checks with
  nothing new failing. "New" is against the last night that ran the check: a
  test that passed then and fails now - most likely after the last upload -
  holds the upload until somebody looks. The first night's failures are its
  baseline; on 2026-10-03, 18 invariants failed on budgets that had drifted
  past their measured values.

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
   new key's fingerprints join to nothing.

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
     --property=StateDirectory=koryta-nightly --pty --wait \
     /home/koryta/koryta/data/nightly/night.sh --force --people-dry-run \
       --export-max-age 24
   ```

   Then read the summary, and the log for the people step's plan
   ("Planned by tier", "The first 100 by tier"):

   ```bash
   gcloud storage cat "gs://koryta-pl-sharedcache/jobs/nightly/runs/date=$(TZ=Europe/Warsaw date +%F)/*.json"
   ```

4. `/etc/koryta/nightly.env` starts with `KORYTA_NIGHTLY_ARGS=--people-dry-run`:
   the nights build and count tonight's people and send none. Delete that line
   when the upload goes live (`go-live-people-import`).

Stop the VM afterwards, or leave it: the schedule boots it at 04:15 either
way, and the timer runs the night on a VM that is already up too.

## Day to day

- **How did last night go?** The row "Noc na maszynie koryta-nightly" on
  `/admin/procesy`; the jobs it ran report under their own names. The summary
  and the whole log are in `gs://koryta-pl-sharedcache/jobs/nightly/runs/` and
  `.../logs/`.
- **Log in during a night.** `sudo touch /etc/koryta/stay-up` before 04:30 and
  the VM stays up afterwards; remove it, or the VM runs - and bills - until
  the schedule's 09:00 stop. A boot outside the night window runs nothing.
- **One step by hand.** `night.sh --force --only people --people-dry-run`
  (the `systemd-run` line above). Steps left out by `--only` or `--skip` hold
  nothing back.
- **Other code.** `KORYTA_REF` in `/etc/koryta/nightly.env` - a tag holds the
  VM still while `main` moves. Every merge to `main` is otherwise live the
  next night.
- **More people.** `KORYTA_NIGHTLY_ARGS=--max-uploads 300`.
- **A changed unit or timer.** Run `setup-vm.sh` again: systemd reads its own
  copies, not the checkout's.
- **Something broken in `versioned/`.** Delete the output; the next night
  restores it from the shared cache or rebuilds it.

## What it costs

At list prices in europe-central2: the VM, e2-highmem-2, is $0.109 an hour -
about $5 a month at an hour and a half a night - and its 30 GB balanced disk
$3.90 a month whether it runs or not. Bucket traffic is under a dollar. The
shared cache grows by the night's backups as `main`; how long it keeps them is
`decide-sharedcache-backup-retention`.

## What it does not do

- The paid rejestr.io scrape: no budget yet (`decide-rejestrio-budget`).
- Companies: `CompaniesPayloads --only-changed` is not sent; a person's missing
  company is created on the way, as the uploader always did.
- `test_rejestrio_coverage.py`: it walks the whole rejestr.io prefix twice, an
  hour and a half - by hand only, as in CI.
- The article crawl.

## Files

| File                     | What                                                                                   |
| ------------------------ | -------------------------------------------------------------------------------------- |
| `create-vm.sh`           | the GCP side, once: service account, grants, secrets, VM, schedule                     |
| `setup-vm.sh`            | the VM side, idempotent: packages, user, uv, Go, checkout, `/etc/koryta`, units          |
| `koryta-nightly.timer`   | 04:30 Warsaw; catches up a missed start after boot                                     |
| `koryta-nightly.service` | runs `night.sh` as `koryta`, then `poweroff.sh` as root                                  |
| `night.sh`               | night window, lock, checkout, venv, compressor, secrets, then `koryta_nightly`         |
| `poweroff.sh`            | powers off after a night run, unless `/etc/koryta/stay-up`                              |
| `nightly.env.example`    | `/etc/koryta/nightly.env`'s first version                                               |
