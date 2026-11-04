#!/bin/bash

# The functions emulator resolves `frontend/functions` through its package
# `main`, which is the compiled `lib/functions/src/index.js`. With `lib` absent
# it loads no trigger at all, prints that among its startup chatter and carries
# on, so the emulators come up looking healthy with `onNodeWritten` and
# `onEdgeWritten` simply not there.
#
# That is invisible to most of the suite, because `scripts/seed-emulator.ts`
# computes `nameChunksLower` and `stats.edges` itself, with the same functions
# the triggers use. It is only a node written while the app is running - a
# person a reader adds from the search box - that needs the trigger, and the
# one spec covering that (`tests/e2e/omni_search_add_person.spec.ts`, "creates
# a person that only logged in users can see") then fails on its last step:
# `/api/search` finds nothing, because nothing ever wrote the new node's index.
#
# `tsc` on this package takes a few seconds, and the alternative is a test that
# is red in every fresh workspace and green in CI, which builds the functions
# as part of deploying them.

set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -d functions/node_modules ]; then
    echo "Error: frontend/functions has no node_modules, so its triggers cannot be built." >&2
    echo "The emulators would start without onNodeWritten, and a node written at" >&2
    echo "run time would never get its search index." >&2
    echo "Run 'npm ci --prefix functions' first (about 15 seconds)." >&2
    exit 1
fi

npm --prefix functions run build
