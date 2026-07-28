#!/bin/bash

set -euo pipefail

BUCKET_PREFIX="gs://koryta-pl-crawled/hostname=koryta.pl/"
export_dir=".firebase/firestore_export"
# Download somewhere else and swap in at the end, so a failed pull leaves the
# previous export in place instead of an empty directory the emulator would
# happily start from.
staging_dir=".firebase/firestore_export.incoming"

if ! command -v gcloud >/dev/null 2>&1; then
    echo "Error: gcloud not found. Install the Google Cloud SDK: https://cloud.google.com/sdk/docs/install" >&2
    exit 1
fi

cleanup() {
    rm -rf "$staging_dir"
}
trap cleanup EXIT

echo "Fetching the latest backup path from $BUCKET_PREFIX..."
# List directories in the bucket, sort them to get the latest `date=` folder
latest_backup_path=$(gcloud storage ls "$BUCKET_PREFIX" | grep 'date=' | sort | tail -n 1)

if [ -z "$latest_backup_path" ]; then
    echo "Error: Could not find any backups in $BUCKET_PREFIX" >&2
    echo "If this is an authentication problem, run: gcloud auth login && gcloud auth application-default login" >&2
    exit 1
fi

echo "Latest backup found at: $latest_backup_path"

rm -rf "$staging_dir"
mkdir -p "$staging_dir"

echo "Downloading backup to $staging_dir..."
gcloud storage cp -r "$latest_backup_path*" "$staging_dir/"

# The emulator only recognises a directory as a Firestore export when it holds
# an *.overall_export_metadata file; without it it starts up silently empty.
if ! compgen -G "$staging_dir/*.overall_export_metadata" >/dev/null; then
    echo "Error: downloaded backup has no *.overall_export_metadata file, refusing to install it" >&2
    exit 1
fi

echo "Installing backup into $export_dir..."
rm -rf "$export_dir"
mkdir -p "$(dirname "$export_dir")"
mv "$staging_dir" "$export_dir"

echo "Backup successfully downloaded to $export_dir"
