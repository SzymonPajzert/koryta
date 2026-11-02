#!/usr/bin/env bash
# Cut the BIP people mode's downloaded declarations into the declarations job's
# tables (bip_decl_cuts, bip_decl_crops, in the crawl's Postgres). It sends
# nothing anywhere: the upload to the site is a separate command.
#
#   cut.sh            cut everything downloaded so far
#   cut.sh 120        stop after two hours (exit 75 when files are left)
#   cut.sh 120 3      the same with 3 workers instead of 4
#   cut.sh status     where the declarations stand (stats.sh, which see)
#
# A file once cut is not cut again, so stop it any time (Ctrl+C) and run it
# again later: it carries on where it stopped.
#
# It runs the code of the checkout it sits in, followed through a symlink. On
# predator that is ~/koryta-bip-declarations, the jj workspace
# bip-declarations-runner, which sits beside the repo so that `workspaces
# prune` leaves it alone. Move it onto a newer main between runs, never during
# one: `jj rebase -r @ -d main@origin` there.
#
#   BIP_POSTGRES_ENV  the crawl's Postgres (~/.config/koryta/bip-postgres.env);
#                     dotenv reads it, as its password does not survive bash
#   BIP_CRAWL_OUT     the crawler's --out, its bundles (~/.cache/koryta/bip-people-crawl)
#   BIP_CUT_LOGS      where each cut's log goes (~/.cache/koryta/bip-declarations/runs)
set -u
# The night's list of people of interest comes from the shared cache each run
# (jobs/bip_crawler/people_list.py); without credentials a run reads the copy on disk.
export GOOGLE_APPLICATION_CREDENTIALS="${GOOGLE_APPLICATION_CREDENTIALS:-$HOME/koryta-pl.json}"
cd "$(dirname "$(readlink -f "$0")")/../../.." || exit 1
run() {
  .venv/bin/dotenv -f "${BIP_POSTGRES_ENV:-$HOME/.config/koryta/bip-postgres.env}" run -- \
    .venv/bin/python -W ignore -m jobs.bip_declarations "$@"
}
if [ "${1:-}" = status ]; then
  shift
  run status "$@"
  exit
fi
logs=${BIP_CUT_LOGS:-$HOME/.cache/koryta/bip-declarations/runs}
mkdir -p "$logs"
LOG=$logs/cut-$(date -u +%Y%m%dT%H%M).log
args=(cut --out "${BIP_CRAWL_OUT:-$HOME/.cache/koryta/bip-people-crawl}" --workers "${2:-4}" --threads 2)
[ -n "${1:-}" ] && args+=(--max-minutes "$1")
run "${args[@]}" 2>&1 | tee "$LOG"
code=${PIPESTATUS[0]}
echo "exit $code" | tee -a "$LOG"
exit "$code"
