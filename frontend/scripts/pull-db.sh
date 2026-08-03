#!/bin/bash

set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/lib/firestore-export.sh"

export_dir=".firebase/firestore_export"
# Download somewhere else and swap in at the end, so a failed pull leaves the
# previous export in place instead of an empty directory the emulator would
# happily start from.
staging_dir=".firebase/firestore_export.incoming"

require_gcloud

cleanup() {
    rm -rf "$staging_dir"
}
trap cleanup EXIT

echo "Fetching the latest backup path from $BUCKET_PREFIX..."
latest_backup_path=$(latest_export_path)

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
