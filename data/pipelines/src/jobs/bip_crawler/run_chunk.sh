#!/usr/bin/env bash
# One chunk of the BIP people-mode crawl (`koryta_scrape_bip crawl
# --people-of-interest`). Resumes where the last chunk stopped, stops the
# crawler itself if / falls under 5 GB free, and writes the found list the
# night reads once the chunk is over.
#
#   run_chunk.sh                  95 minutes, 20 units at once
#   run_chunk.sh 60 10            60 minutes, 10 units
#   run_chunk.sh 95 20 --poi-retry unreachable --poi-retry-before 2026-11-02T08:00Z
#                                 anything after the first two goes to the crawler
#
# 95 minutes, because an agent's background command dies at two hours and a
# chunk's renders finish past its deadline. The log is $BIP_CRAWL_OUT/runs/
# all-<UTC>.log; it ends with the crawler's JSON summary and "exit N" (75: the
# time ran out with work left). Only one crawl may run on one Postgres.
#
# It runs the code of the checkout it sits in, followed through a symlink. On
# predator that is the jj workspace bip-crawl-runner. Move it onto newer code
# between chunks, never during one: `jj rebase -r @ -d main@origin` there,
# after checking uv.lock and pyproject.toml for new dependencies.
#
#   BIP_POSTGRES_ENV  the crawl's Postgres (~/.config/koryta/bip-postgres.env);
#                     dotenv reads it, as its password does not survive bash
#   BIP_CRAWL_OUT     bundles, registry, CA bundle, logs (~/.cache/koryta/bip-people-crawl)
#   BIP_KNOWN_URLS    the blind crawl's BipUrlsClassified, for --known-urls
#                     ($BIP_CRAWL_OUT/known-urls/bip_urls_classified)
set -u
# The night's list of people of interest comes from the shared cache each run
# (jobs/bip_crawler/people_list.py); without credentials a run reads the copy on disk.
export GOOGLE_APPLICATION_CREDENTIALS="${GOOGLE_APPLICATION_CREDENTIALS:-$HOME/koryta-pl.json}"
cd "$(dirname "$(readlink -f "$0")")/../../.." || exit 1
ENV_FILE=${BIP_POSTGRES_ENV:-$HOME/.config/koryta/bip-postgres.env}
OUT=${BIP_CRAWL_OUT:-$HOME/.cache/koryta/bip-people-crawl}
KNOWN=${BIP_KNOWN_URLS:-$OUT/known-urls/bip_urls_classified}
# Where the file sat until it moved beside the crawl: inside the 10-23 kit.
[ -e "$KNOWN" ] || [ -n "${BIP_KNOWN_URLS:-}" ] ||
  KNOWN=$HOME/.cache/koryta/bip-birthdates-2026-10-23/shared/urls/bip_urls_classified
mkdir -p "$OUT/runs"
LOG=$OUT/runs/all-$(date -u +%Y%m%dT%H%M).log
.venv/bin/dotenv -f "$ENV_FILE" run -- \
  .venv/bin/koryta_scrape_bip crawl --people-of-interest --out "$OUT" \
  --xml-cache "$OUT/registry/subjects.xml" --ca-bundle "$OUT/tls/ca-bundle.pem" \
  --known-urls "$KNOWN" --workers "${2:-20}" --max-minutes "${1:-95}" "${@:3}" \
  > "$LOG" 2>&1 &
pid=$!
while kill -0 "$pid" 2>/dev/null; do
  avail=$(df --output=avail -BG / | tail -1 | tr -dc 0-9)
  if [ "${avail:-0}" -lt 5 ]; then
    echo "low disk: ${avail}G free, stopping the crawler" >> "$LOG"
    pkill -TERM -f "koryta_scrape_bip crawl --people-of-interest"
    break
  fi
  sleep 30
done
wait "$pid"
code=$?
echo "exit $code" >> "$LOG"
# The found list the night's declaration groups read: a new part in the shared
# cache after every chunk, ~200 KB. Reads Postgres only.
.venv/bin/dotenv -f "$ENV_FILE" run -- \
  .venv/bin/koryta_scrape_bip found >> "$LOG" 2>&1 || echo "found list: not written" >> "$LOG"
df -h / | tail -1 >> "$LOG"
echo "$LOG"
tail -48 "$LOG"
