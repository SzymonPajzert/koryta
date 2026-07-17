#!/bin/bash

set -e

BUCKET_PREFIX="gs://koryta-pl-crawled/hostname=koryta.pl/"
export_dir=".firebase/firestore_export"

echo "Fetching the latest backup path from $BUCKET_PREFIX..."
# List directories in the bucket, sort them to get the latest `date=` folder
latest_backup_path=$(gsutil ls "$BUCKET_PREFIX" | grep 'date=' | sort | tail -n 1)

if [ -z "$latest_backup_path" ]; then
    echo "Error: Could not find any backups in $BUCKET_PREFIX"
    exit 1
fi

echo "Latest backup found at: $latest_backup_path"

echo "Cleaning up old backup directory ($export_dir)..."
rm -rf "$export_dir"
mkdir -p "$export_dir"

echo "Downloading backup to $export_dir..."
# Sync all_namespaces subdirectory (no colons in these paths, safe on Windows)
mkdir -p "$export_dir/all_namespaces"
gsutil -m rsync -r "${latest_backup_path}all_namespaces" "$export_dir/all_namespaces/"

# The overall_export_metadata file has a colon-containing GCS name (e.g. date=2026-07-17T03:52:08.850Z.overall_export_metadata)
# which Windows rejects as a local filename. Find and download it with a safe name instead.
metadata_gcs_path=$(gsutil ls "${latest_backup_path}*.overall_export_metadata" 2>/dev/null | head -n 1)
if [ -z "$metadata_gcs_path" ]; then
    echo "Error: Could not find overall_export_metadata in $latest_backup_path"
    exit 1
fi
gsutil cp "$metadata_gcs_path" "$export_dir/firestore_export.overall_export_metadata"

echo "Backup successfully downloaded to $export_dir"
