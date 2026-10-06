#!/bin/sh
# Power the VM off after a night run, or after the requests worker has done
# what it was started for: the ExecStopPost of koryta-nightly.service
# (`poweroff.sh`) and of koryta-requests.service (`poweroff.sh requests`), run
# as root however the unit ended.
#
# Only when asked - night.sh asks for a night run, never for a daytime boot or
# a forced run; the requests worker once it has run something and gone idle -
# and never while /etc/koryta/stay-up exists: `sudo touch /etc/koryta/stay-up`
# before a night you want to log in to, and remove it afterwards, or the VM
# runs (and bills) until the schedule's stop.
#
# After a night, a run asked for on the site that is going or waiting keeps
# the VM up: the requests worker does it and switches the VM off itself.
set -u

STATE=/var/lib/koryta-nightly
REQUEST=$STATE/poweroff-requested
STAY_UP=/etc/koryta/stay-up
WORKER=/home/koryta/koryta/data/pipelines/.venv/bin/koryta_job_requests

[ -e "$REQUEST" ] || exit 0
rm -f "$REQUEST"
if [ -e "$STAY_UP" ]; then
  echo "poweroff.sh: $STAY_UP exists, staying up"
  exit 0
fi
if [ "${1:-night}" = night ] && systemctl is-active --quiet koryta-requests.service; then
  # `flock -n` fails while the worker holds the lock, i.e. has a run in hand.
  if ! flock -n "$STATE/requests.busy" true; then
    echo "poweroff.sh: a run asked for on the site is going; the requests worker switches the VM off"
    exit 0
  fi
  if [ -x "$WORKER" ] && runuser -u koryta -- "$WORKER" --pending; then
    echo "poweroff.sh: a run asked for on the site is waiting; the requests worker switches the VM off"
    exit 0
  fi
fi
echo "poweroff.sh: ${1:-night} run over, powering off"
# --no-block: this runs inside the unit's own stop job, which a blocking
# poweroff would wait on.
systemctl poweroff --no-block
