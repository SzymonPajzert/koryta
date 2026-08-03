#!/bin/bash

# Builds the preview environment: the `koryta-pl-preview` Firebase project and
# everything production has that a branch on a phone needs - two Firestore
# databases, a Realtime Database, rules, indexes, triggers, a copy of the data
# and a handful of synthetic accounts to sign in with.
#
# A separate project rather than a second database inside koryta-pl, so that a
# preview deployment holds no credentials on production at all. The cost is
# this script; every step is idempotent, so run it again after a failure, or
# whenever something has drifted.
#
#   npm run preview:setup
#
# Needs gcloud and an account with rights to create a project in the
# organisation, plus a billing account to attach (BILLING_ACCOUNT, or whatever
# koryta-pl uses). The one thing it cannot do is create the App Hosting
# backend, which needs a repository connection through the console; it stops
# and says so.

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

PROJECT="${PREVIEW_PROJECT:-koryta-pl-preview}"
PROD_PROJECT="${FIREBASE_PROJECT:-koryta-pl}"
DATABASE="${PREVIEW_FIRESTORE_DATABASE:-koryta-pl}"
LOCATION="${PREVIEW_FIRESTORE_LOCATION:-europe-central2}"
BACKEND="${PREVIEW_BACKEND:-preview}"
RTDB="$PROJECT-default-rtdb"

if [ "$PROJECT" = "$PROD_PROJECT" ]; then
    echo "Error: PREVIEW_PROJECT is $PROJECT, which is production." >&2
    exit 1
fi

for tool in gcloud npx; do
    if ! command -v "$tool" >/dev/null 2>&1; then
        echo "Error: $tool not found." >&2
        exit 1
    fi
done

step() { echo; echo "== $* =="; }
# Steps that need rights this account may not have are worth continuing past:
# the rest of the script still gets the environment most of the way there, and
# what failed is printed again at the end.
skipped=()
try() {
    local what="$1"
    shift
    if ! "$@"; then
        echo "!! $what failed - carrying on"
        skipped+=("$what")
    fi
}

step "Project $PROJECT"
if gcloud projects describe "$PROJECT" >/dev/null 2>&1; then
    echo "already exists"
else
    gcloud projects create "$PROJECT" --name="Koryta preview"
fi

billing="${BILLING_ACCOUNT:-}"
if [ -z "$billing" ]; then
    # Whatever production is billed to, which is the account this is meant to
    # sit next to. Readable only with billing rights; unset is not fatal here.
    billing=$(gcloud billing projects describe "$PROD_PROJECT" \
        --format='value(billingAccountName)' 2>/dev/null | sed 's|billingAccounts/||' || true)
fi
if [ -n "$billing" ]; then
    try "linking billing account $billing" \
        gcloud billing projects link "$PROJECT" --billing-account "$billing"
else
    echo "!! no billing account found. App Hosting and Cloud Functions need"
    echo "   one; set BILLING_ACCOUNT and re-run, or link it in the console."
    skipped+=("linking a billing account")
fi

step "APIs"
gcloud services enable \
    firebase.googleapis.com \
    firestore.googleapis.com \
    firebasedatabase.googleapis.com \
    firebaserules.googleapis.com \
    identitytoolkit.googleapis.com \
    cloudfunctions.googleapis.com \
    cloudbuild.googleapis.com \
    run.googleapis.com \
    eventarc.googleapis.com \
    artifactregistry.googleapis.com \
    firebaseapphosting.googleapis.com \
    developerconnect.googleapis.com \
    --project "$PROJECT"

step "Firebase"
if npx firebase projects:list 2>/dev/null | grep -qw "$PROJECT"; then
    echo "already a Firebase project"
else
    npx firebase projects:addfirebase "$PROJECT"
fi

step "Web app"
# The registration App Hosting hands to a build as FIREBASE_WEBAPP_CONFIG.
# Nothing in the repo names its api key: the project supplies it.
if ! npx firebase apps:list WEB --project "$PROJECT" 2>/dev/null | grep -q WEB; then
    npx firebase apps:create WEB "Koryta preview" --project "$PROJECT"
fi
npx firebase apps:sdkconfig WEB --project "$PROJECT" || true

step "Firestore databases"
# Two, as production has them: koryta-pl for the site's data, the unnamed one
# for `users`. See shared/firebase-env.ts on why production is arranged that
# way and why preview copies it rather than tidying it.
for db in "$DATABASE" "(default)"; do
    if gcloud firestore databases describe \
        --database="$db" --project="$PROJECT" >/dev/null 2>&1; then
        echo "$db already exists"
    else
        gcloud firestore databases create \
            --database="$db" --location="$LOCATION" \
            --type=firestore-native --project="$PROJECT"
    fi
done

step "Realtime Database $RTDB"
# Only ever written to (user/<uid> from the profile and login pages), so it
# starts empty rather than being copied from production.
if npx firebase database:instances:list --project "$PROJECT" 2>/dev/null |
    grep -qw "$RTDB"; then
    echo "already exists"
else
    try "creating the Realtime Database instance" \
        npx firebase database:instances:create "$RTDB" --project "$PROJECT"
fi

step "Email/password sign-in"
# There is no CLI for this, and Auth with no provider enabled would leave the
# synthetic accounts below unable to sign in. Identity Platform has to be
# initialised once before its config can be patched; both calls are fine to
# repeat, so an ALREADY_EXISTS here is the good case.
token=$(gcloud auth print-access-token)
curl -sS -X POST -o /dev/null \
    -H "Authorization: Bearer $token" \
    -H "Content-Type: application/json" \
    "https://identitytoolkit.googleapis.com/v2/projects/$PROJECT/identityPlatform:initializeAuth" \
    -d '{}' || true
try "enabling email/password sign-in" \
    curl -sS --fail -X PATCH -o /dev/null \
    -H "Authorization: Bearer $token" \
    -H "Content-Type: application/json" \
    "https://identitytoolkit.googleapis.com/admin/v2/projects/$PROJECT/config?updateMask=signIn.email.enabled,signIn.email.passwordRequired" \
    -d '{"signIn":{"email":{"enabled":true,"passwordRequired":true}}}'

step "Rules and indexes"
# firebase.preview.json names this project's databases and nothing else, so
# this command has no way to reach production even if the project flag is lost.
npx firebase deploy --only firestore,database \
    --config ../../firebase.preview.json --project "$PROJECT"

step "Read access to the export bucket"
# The import below is Google-side: it is Firestore in the preview project that
# reads the bucket, as its own service agent, not this machine.
project_number=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')
agent="service-$project_number@gcp-sa-firestore.iam.gserviceaccount.com"
try "granting $agent objectViewer on the export bucket" \
    gcloud storage buckets add-iam-policy-binding gs://koryta-pl-crawled \
    --member="serviceAccount:$agent" --role=roles/storage.objectViewer \
    --project "$PROD_PROJECT"

step "Data"
try "importing the latest export" bash ./refresh-preview-db.sh

step "Synthetic accounts"
try "seeding accounts" npx tsx ./seed-preview-auth.ts

step "Triggers"
# The functions name `database: "koryta-pl"`, which is this project's database
# too, so the codebase deploys unchanged and preview writes derive the same
# fields production's do. scheduledFirestoreExport checks the project and does
# nothing here, so the nightly export stays production's.
try "deploying functions" npx firebase deploy --only functions \
    --config ../../firebase.preview.json --project "$PROJECT"

if [ ${#skipped[@]} -gt 0 ]; then
    step "Did not finish"
    printf '  * %s\n' "${skipped[@]}"
    echo "Re-run this script once the rights or the billing account are in place."
fi

step "Left to do by hand, once"
cat <<EOF
An App Hosting backend cannot be created non-interactively with a repository
connection, so create it in the console:

  https://console.firebase.google.com/project/$PROJECT/apphosting

  * Backend id:       $BACKEND
  * Repository:       SzymonPajzert/koryta
  * Live branch:      main, with "automatic rollouts" OFF
                      (rollouts are triggered per branch by
                      .github/workflows/preview.yml, not by pushes)
  * Root directory:   frontend
  * Web app:          the one created above - this is what makes App Hosting
                      pass FIREBASE_WEBAPP_CONFIG to the build, which is where
                      the build learns this project's api key and app id
  * Environment name: preview
                      This is what makes the backend read
                      frontend/apphosting.preview.yaml. Without it the build
                      comes up as production, notices it is running in
                      $PROJECT, and refuses to serve.

Then, so CI can roll out to it, grant the service account in the
GCP_PREVIEW_SERVICE_ACCOUNT repository variable roles/firebaseapphosting.admin
on $PROJECT:

  gcloud projects add-iam-policy-binding $PROJECT \\
    --member=serviceAccount:<GCP_PREVIEW_SERVICE_ACCOUNT> \\
    --role=roles/firebaseapphosting.admin

and set PREVIEW_URL to the backend's URL.
EOF
