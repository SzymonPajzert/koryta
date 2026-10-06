#!/bin/sh
# Power the VM off after a night run: koryta-nightly.service's ExecStopPost,
# run as root whatever night.sh exited with.
#
# Only when night.sh asked for it - it does so for a night run, never for a
# daytime boot or a forced run - and never while /etc/koryta/stay-up exists:
# `sudo touch /etc/koryta/stay-up` before a night you want to log in to, and
# remove it afterwards, or the VM runs (and bills) until the schedule's stop.
set -u

REQUEST=/var/lib/koryta-nightly/poweroff-requested
STAY_UP=/etc/koryta/stay-up

[ -e "$REQUEST" ] || exit 0
rm -f "$REQUEST"
if [ -e "$STAY_UP" ]; then
  echo "poweroff.sh: $STAY_UP exists, staying up"
  exit 0
fi
echo "poweroff.sh: night run over, powering off"
# --no-block: this runs inside the unit's own stop job, which a blocking
# poweroff would wait on.
systemctl poweroff --no-block
