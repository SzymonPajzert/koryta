#!/bin/bash

# Loads the newest nightly export into the preview project's Firestore - the
# same bytes `npm run db:pull` downloads for the emulator, imported by Google
# from the bucket, so nothing has to come through this machine.
#
# Import merges: it writes every document in the export over whatever is there
# and leaves anything else alone. So documents deleted in production since the
# last refresh, and edits made through the preview site, survive. Pass --fresh
# to drop the database and recreate it first, which is the only way to get a
# faithful copy.
#
#   npm run db:preview:refresh
#   npm run db:preview:refresh -- --fresh
#
# The export does not carry `users` - it never did, that collection lives in
# the other database - so the accounts stay whatever seed-preview-auth.ts made
# them, including through --fresh.

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

source ./lib/firestore-export.sh

PROJECT="${PREVIEW_PROJECT:-koryta-pl-preview}"
PROD_PROJECT="${FIREBASE_PROJECT:-koryta-pl}"
DATABASE="${PREVIEW_FIRESTORE_DATABASE:-koryta-pl}"
LOCATION="${PREVIEW_FIRESTORE_LOCATION:-europe-central2}"

fresh=false
for arg in "$@"; do
    case "$arg" in
    --fresh) fresh=true ;;
    *)
        echo "Unknown argument: $arg" >&2
        exit 2
        ;;
    esac
done

require_gcloud

# The database ids are the same in both projects - that is the point, it makes
# the import and the rules one-for-one - so it is the project that has to be
# checked here, and nothing else in this script names production.
if [ "$PROJECT" = "$PROD_PROJECT" ]; then
    echo "Error: PREVIEW_PROJECT is $PROJECT, which is production." >&2
    echo "This script deletes and overwrites; refusing." >&2
    exit 1
fi

if [ "$fresh" = true ]; then
    echo "Deleting $PROJECT/$DATABASE so the import lands on an empty database..."
    gcloud firestore databases delete \
        --database="$DATABASE" --project="$PROJECT" --quiet
    echo "Recreating $DATABASE in $LOCATION..."
    gcloud firestore databases create \
        --database="$DATABASE" --location="$LOCATION" \
        --type=firestore-native --project="$PROJECT" --quiet
    echo "Redeploying rules and indexes onto the new database..."
    npx firebase deploy --only firestore \
        --config ../../firebase.preview.json --project "$PROJECT"
fi

echo "Fetching the latest backup path from $BUCKET_PREFIX..."
latest_backup_path=$(latest_export_path)
# gcloud wants the export directory, without the trailing slash `ls` leaves on.
latest_backup_path="${latest_backup_path%/}"
echo "Latest backup found at: $latest_backup_path"

# An import runs asynchronously on Google's side; --async would return before
# the data is there, which is exactly when someone would open the preview site
# and find it half full.
echo "Importing into $PROJECT/$DATABASE (this takes a few minutes)..."
gcloud firestore import "$latest_backup_path" \
    --database="$DATABASE" --project="$PROJECT"

echo "Preview database refreshed from $latest_backup_path"
