#!/bin/bash

# The emulator treats a missing or unrecognisable --import directory as "no data
# to import" and starts up empty, which looks like a broken app rather than a
# missing download. Fail before that happens.

set -euo pipefail

export_dir=".firebase/firestore_export"

if ! compgen -G "$export_dir/*.overall_export_metadata" >/dev/null; then
    echo "Error: no Firestore export in $export_dir — the emulators would start empty." >&2
    echo "Run 'npm run db:pull' first." >&2
    exit 1
fi
