#!/usr/bin/env bash
# Count the people a BIP declaration can publish, each in the stage they are
# in, and send the site the snapshot its home page, /oswiadczenia/postep and
# /admin/oswiadczenia show (`koryta_bip_declarations people`). On predator the
# user timer koryta-declaration-people (systemd/ next to this file) runs it
# every morning.
#
#   people.sh             count, and send it to the site
#   people.sh --dry-run   count and print it; send nothing
#
# It reads the night's list from the shared cache, the crawl's Postgres, and
# the newest export of the site. The export goes where the morning check keeps
# its copies, and is fetched only when that check has not fetched it already.
# Like cut.sh, it runs the code of the checkout it sits in, followed through a
# symlink: ~/koryta-bip-declarations on predator.
#
#   BIP_POSTGRES_ENV   the crawl's Postgres (~/.config/koryta/bip-postgres.env)
#   KORYTA_EXPORTS     the exports (~/.cache/koryta/firestore-export)
#   BIP_PEOPLE_LOGS    each run's log and snapshot (~/.cache/koryta/bip-declarations/people)
#   KORYTA_ENDPOINT    the site (autopush, which writes production's Firestore)
#
# Exit codes are the job's: 0 sent, 75 the site or the export is not there yet
# (a later run will do), 1 refused or nothing to count from.
set -u
here="$(dirname "$(readlink -f "$0")")"
cd "$here/../../.." || exit 1
bucket=gs://koryta-pl-crawled/hostname=koryta.pl
exports=${KORYTA_EXPORTS:-$HOME/.cache/koryta/firestore-export}
logs=${BIP_PEOPLE_LOGS:-$HOME/.cache/koryta/bip-declarations/people}
mkdir -p "$exports" "$logs"
stamp=$(date -u +%Y%m%dT%H%M)
LOG=$logs/people-$stamp.log

newest=$(gcloud storage ls "$bucket/" 2>>"$LOG" | grep '/date=' | sort | tail -1)
name=$(basename "${newest%/}")
if [ -z "$name" ]; then
  echo "no export listed under $bucket" | tee -a "$LOG"
  exit 75
fi
if [ ! -d "$exports/$name/all_namespaces" ]; then
  # Firestore writes the export's own metadata file last.
  if ! gcloud storage ls "$newest$name.overall_export_metadata" >/dev/null 2>&1; then
    echo "$name is still being written" | tee -a "$LOG"
    exit 75
  fi
  # Every collection, as the morning check fetches it: it takes the directory
  # for the whole export once it is there.
  staging=$exports/.incoming-$name
  rm -rf "$staging" && mkdir -p "$staging"
  if ! gcloud storage cp -r "${newest}all_namespaces" "$staging/" >>"$LOG" 2>&1; then
    rm -rf "$staging"
    echo "fetching $name failed" | tee -a "$LOG"
    exit 75
  fi
  mv -T "$staging" "$exports/$name" 2>>"$LOG" || rm -rf "$staging"
fi

export GOOGLE_APPLICATION_CREDENTIALS="${GOOGLE_APPLICATION_CREDENTIALS:-$HOME/koryta-pl.json}"
# The job signs in as its own robot account (stores/koryta_login.py).
export KORYTA_PIPELINE_UID=${KORYTA_PIPELINE_UID:-pipeline-declarations}
FIREBASE_WEB_API_KEY=${FIREBASE_WEB_API_KEY:-$(sed -n 's/^ *apiKey: "\([^"]*\)".*/\1/p' ../../frontend/nuxt.config.ts | head -1)}
export FIREBASE_WEB_API_KEY
args=(people --export "$exports/$name" --json "$logs/people-$stamp.json")
[ "${1:-}" = --dry-run ] || args+=(--send)
.venv/bin/dotenv -f "${BIP_POSTGRES_ENV:-$HOME/.config/koryta/bip-postgres.env}" run -- \
  .venv/bin/python -W ignore -m jobs.bip_declarations "${args[@]}" 2>&1 | tee -a "$LOG"
code=${PIPESTATUS[0]}
echo "exit $code" | tee -a "$LOG"
exit "$code"
