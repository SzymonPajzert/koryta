set -x
set -e

# Go to https://console.cloud.google.com/firestore/databases/-default-/import-export
# Initiate a new export to a koryta-pl-firestore-backups Cloud Storage

# Set the timestamp of the export here
LATEST_TIMESTAMP=2025-09-12T14:02:44_61647

mkdir -p firestore_copy

if ! [[ -d ./firestore_copy/${LATEST_TIMESTAMP} ]] ; then
    echo "Downloading the latest export"
    gsutil -m cp -r gs://koryta-pl-firestore-backups/${LATEST_TIMESTAMP} ./firestore_copy
fi

firebase emulators:start --import=./firestore_copy/${LATEST_TIMESTAMP}

# You should be able to see the DB in http://127.0.0.1:4000/firestore/default/data