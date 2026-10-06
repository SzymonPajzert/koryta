#!/usr/bin/env bash
# koryta-nightly.service's ExecStart (koryta-nightly.timer starts it at 04:30,
# half an hour after the 04:00 Firestore export).
# Checks that it is night, brings the checkout and its environment up to date,
# and hands over to koryta_nightly (data/pipelines/src/jobs/nightly), which
# runs the night's steps.
#
#   night.sh                    the scheduled run: only inside the night
#                               window, and the VM powers off when it is over
#   night.sh --force [ARGS...]  a run by hand, at any time, never powering
#                               off; ARGS go to koryta_nightly, e.g.
#                               --only people, or --dry-run
#
# By hand, the way the service runs it - a service of its own, which a dropped
# SSH connection does not end (`--pty` would: koryta_nightly handles only
# SIGTERM, and a hangup kills it):
#   sudo systemd-run --unit=koryta-nightly-manual --uid=koryta --gid=koryta \
#     --property=EnvironmentFile=/etc/koryta/nightly.env \
#     --property=StateDirectory=koryta-nightly \
#     /home/koryta/koryta/data/nightly/night.sh --force
#   journalctl -u koryta-nightly-manual -f
set -euo pipefail

# bash reads a script while it runs it, and the checkout below can rewrite
# this very file under it. Run from a copy.
if [[ "${KORYTA_BOOT_COPY:-}" != 1 ]]; then
  copy=$(mktemp /tmp/koryta-nightly-boot.XXXXXX)
  cp "$0" "$copy"
  KORYTA_BOOT_COPY=1 exec bash "$copy" "$@"
fi

force=0
if [[ "${1:-}" == "--force" ]]; then
  force=1
  shift
fi

repo=${KORYTA_REPO:-/home/koryta/koryta}
ref=${KORYTA_REF:-origin/main}
state=${STATE_DIRECTORY:-/var/lib/koryta-nightly}
# The night is Warsaw's, and so are the pipelines' naive dates.
export TZ=Europe/Warsaw
export PATH="$HOME/.local/bin:/usr/local/go/bin:$PATH"

# 03:00-08:00 by default. The timer catches up on a missed 04:30 at the next
# boot, so a start outside the window is somebody booting the VM to look at
# it: run nothing, and leave it up.
in_night_window() {
  local now=$((10#$1)) from=$((10#${KORYTA_NIGHT_FROM:-0300})) until=$((10#${KORYTA_NIGHT_UNTIL:-0800}))
  if ((from <= until)); then
    ((now >= from && now < until))
  else
    ((now >= from || now < until))
  fi
}

now=$(date +%H%M)
if ((force == 0)); then
  if ! in_night_window "$now"; then
    echo "Started at $now (Warsaw), outside the night window: running nothing, staying up."
    exit 0
  fi
  # From here on poweroff.sh switches the VM off when the unit stops, however
  # this script ends - a failed update included.
  touch "$state/poweroff-requested"
fi

exec 9>"$state/lock"
if ! flock --nonblock 9; then
  echo "Another night run holds $state/lock; not starting a second one."
  exit 1
fi

echo "$(date -Is) koryta nightly on $(hostname), code $ref"

# The code. --force: this checkout is the VM's alone, nothing edits it by hand.
git -C "$repo" fetch --quiet --prune origin
git -C "$repo" checkout --quiet --force --detach "$ref"
version=$(git -C "$repo" rev-parse HEAD)
echo "Code: $version $(git -C "$repo" log -1 --format=%s)"

# Its environment: the pipelines' base dependencies plus pytest for the
# invariants (not the ml group, 4.5 GB of torch nothing here needs), and the
# compressor built from the same checkout.
(cd "$repo/data/pipelines" && uv sync --frozen --no-default-groups --group test)
mkdir -p "$state/bin"
(cd "$repo/data/compressor" && go build -o "$state/bin/compressor" ./cmd/compressor)

# Secrets from Secret Manager into this process's environment only, never onto
# the disk: the PESEL key KrsOdpisSeats fingerprints with, the web key the
# people import exchanges its custom token with (public, but kept with the
# others), and the rejestr.io key. create-vm.sh makes them; the first two are
# also the people import's Cloud Run runbook's (data/pipelines/src/jobs/CLOUD_RUN.md).
secret() {
  gcloud secrets versions access latest --secret="$1" --quiet 2>/dev/null
}
if [[ -z "${KORYTA_PESEL_SALT:-}" && -n "${KORYTA_PESEL_SECRET:-}" ]]; then
  if KORYTA_PESEL_SALT=$(secret "$KORYTA_PESEL_SECRET"); then
    export KORYTA_PESEL_SALT
  else
    echo "Could not read the PESEL key ($KORYTA_PESEL_SECRET): the steps that need it will be skipped."
  fi
fi
if [[ -z "${FIREBASE_WEB_API_KEY:-}" && -n "${KORYTA_WEB_KEY_SECRET:-}" ]]; then
  if FIREBASE_WEB_API_KEY=$(secret "$KORYTA_WEB_KEY_SECRET"); then
    export FIREBASE_WEB_API_KEY
  else
    echo "Could not read the web key ($KORYTA_WEB_KEY_SECRET): the people import will be skipped."
  fi
fi
# The rejestr.io key the paid step buys with. Read by default, so a VM set up
# before the step existed picks it up as soon as the secret has a version; an
# empty KORYTA_REJESTR_SECRET switches the step off.
rejestr_secret=${KORYTA_REJESTR_SECRET-rejestr-io-key}
if [[ -z "${REJESTR_KEY:-}" && -n "$rejestr_secret" ]]; then
  if REJESTR_KEY=$(secret "$rejestr_secret"); then
    export REJESTR_KEY
  else
    echo "Could not read the rejestr.io key ($rejestr_secret): the paid step will be skipped."
  fi
fi

export KORYTA_VERSION="$version"
export KORYTA_COMPRESSOR="$state/bin/compressor"
export KORYTA_NIGHTLY_LOGS="$state/logs"
deadline=()
if ((force)); then
  export KORYTA_JOB_TRIGGER=manual
else
  export KORYTA_JOB_TRIGGER=schedule
  # Nothing new starts after this, so the night is over before the instance
  # schedule's 09:00 stop; a hand run has no deadline.
  deadline=(--stop-by "${KORYTA_NIGHT_STOP_BY:-08:30}")
fi

cd "$repo/data/pipelines"
# KORYTA_NIGHTLY_ARGS is split into words on purpose: it is a list of flags.
# shellcheck disable=SC2086
exec .venv/bin/koryta_nightly "${deadline[@]}" ${KORYTA_NIGHTLY_ARGS:-} "$@"
