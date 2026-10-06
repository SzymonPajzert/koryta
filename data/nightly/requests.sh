#!/usr/bin/env bash
# koryta-requests.service's ExecStart: the worker that does what the
# datascience group asks for on the site's pages - "send this company's people"
# from a company page, "send this person" from a person's - while the VM is up
# (`koryta_job_requests`, data/pipelines/src/jobs/requests).
#
# The site starts the VM when somebody asks (frontend/server/utils/jobRunner.ts),
# so this runs at every boot. It takes the queued runs one at a time, each
# under the night's lock, and once it has run something and nothing more comes
# for ten minutes it leaves poweroff-requested and exits; poweroff.sh then
# switches the VM off. A VM booted by hand, where it has run nothing, stays up.
#
# It runs the code and the outputs the last night left: no checkout, no sync.
# The outputs on disk are that code's, and a run reads them as they are
# (`--refresh none`).
set -euo pipefail

repo=${KORYTA_REPO:-/home/koryta/koryta}
state=${STATE_DIRECTORY:-/var/lib/koryta-nightly}
export TZ=Europe/Warsaw
export PATH="$HOME/.local/bin:$PATH"

# The web key the people import exchanges its custom token with, as night.sh
# reads it. The PESEL key is not needed: nothing is rebuilt.
if [[ -z "${FIREBASE_WEB_API_KEY:-}" && -n "${KORYTA_WEB_KEY_SECRET:-}" ]]; then
  if FIREBASE_WEB_API_KEY=$(gcloud secrets versions access latest \
    --secret="$KORYTA_WEB_KEY_SECRET" --quiet 2>/dev/null); then
    export FIREBASE_WEB_API_KEY
  else
    echo "Could not read the web key ($KORYTA_WEB_KEY_SECRET): the runs will not sign in."
  fi
fi

cd "$repo/data/pipelines"
# KORYTA_REQUESTS_ARGS is split into words on purpose: it is a list of flags.
# shellcheck disable=SC2086
exec .venv/bin/koryta_job_requests --watch \
  --lock "$state/lock" \
  --busy "$state/requests.busy" \
  --poweroff-flag "$state/poweroff-requested" \
  ${KORYTA_REQUESTS_ARGS:-}
