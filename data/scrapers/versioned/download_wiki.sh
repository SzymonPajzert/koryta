#!/bin/bash

# This script downloads the latest Polish Wikipedia articles dump.

# URL for the latest Polish Wikipedia articles dump
DUMP_URL="https://dumps.wikimedia.org/plwiki/latest/plwiki-latest-pages-articles-multistream.xml.bz2"

# Output filename
OUTPUT_FILE="plwiki-latest-articles.xml.bz2"

echo "➡️  Starting download of the Polish Wikipedia dump..."
echo "URL: $DUMP_URL"
echo "This is a very large file and may take a long time."

# Use wget to download the file. The -c flag allows resuming if interrupted.
wget -c "$DUMP_URL" -O "$OUTPUT_FILE"

if [ $? -eq 0 ]; then
    echo "✅ Download complete!"
    echo "File saved as: $OUTPUT_FILE"
else
    echo "❌ Download failed. Please check your connection and the URL."
fi