#!/bin/bash

# Where the nightly Firestore backup lands, and how to find the newest one.
# Sourced by pull-db.sh (which downloads it for the emulator) and by
# refresh-preview-db.sh (which imports the same bytes into the preview
# database), so the two can never disagree about what "the latest export" is.

BUCKET_PREFIX="gs://koryta-pl-crawled/hostname=koryta.pl/"

require_gcloud() {
    if ! command -v gcloud >/dev/null 2>&1; then
        echo "Error: gcloud not found. Install the Google Cloud SDK: https://cloud.google.com/sdk/docs/install" >&2
        exit 1
    fi
}

# Prints the gs:// path of the newest date= directory, or fails loudly.
latest_export_path() {
    local path
    # The date= names sort lexicographically because they are ISO timestamps.
    path=$(gcloud storage ls "$BUCKET_PREFIX" | grep 'date=' | sort | tail -n 1)

    if [ -z "$path" ]; then
        echo "Error: Could not find any backups in $BUCKET_PREFIX" >&2
        echo "If this is an authentication problem, run: gcloud auth login && gcloud auth application-default login" >&2
        exit 1
    fi

    echo "$path"
}
