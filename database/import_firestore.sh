set -x
set -e

# Go to https://console.cloud.google.com/firestore/databases/-default-/import-export
# Initiate a new export to a koryta-pl-firestore-backups Cloud Storage

# Set the timestamp of the export here
LATEST_TIMESTAMP=2025-09-13T12:13:52_72256

rm -r current_firestore

if ! [[ -d ./${LATEST_TIMESTAMP} ]] ; then
    echo "Downloading the latest export"
    gsutil -m cp -r gs://koryta-pl-firestore-backups/${LATEST_TIMESTAMP} .
fi

cp -r ${LATEST_TIMESTAMP} current_firestore

# firebase emulators:start --import=./${LATEST_TIMESTAMP}
# You should be able to see the DB in http://127.0.0.1:4000/firestore/default/data
# Remember to set `export FIRESTORE_EMULATOR_HOST="127.0.0.1:8080"` to access it from scripts.
# You can dump the modified data with `firebase emulators:export ./firestore_modified`
