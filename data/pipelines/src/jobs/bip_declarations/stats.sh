#!/usr/bin/env bash
# Where the BIP declarations stand: candidacies found, files downloaded, cut,
# cropped and sent to the site by priority, and the units (TERYT) with nothing
# downloaded. Reads only (the night's list from the shared cache, the crawl's
# Postgres), so it runs beside a crawl chunk or a cut. `cut.sh status` is the
# same; cut.sh says how the two find the code and the database.
#
#   stats.sh                      the summary, with the 20 biggest empty units
#   stats.sh --units 50           50 of them
#   stats.sh --units-csv f.csv    every empty unit, as CSV
exec "$(dirname "$(readlink -f "$0")")/cut.sh" status "$@"
