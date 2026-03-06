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
gsutil -m cp -r "$latest_backup_path*" "$export_dir/"

echo "Backup successfully downloaded to $export_dir"
