#!/usr/bin/env bash
# Create everything the nightly VM needs in koryta-pl, once, as the project
# owner: its service account and that account's grants, the three secrets it
# reads, the VM, and the schedule that starts it. Each step checks first, so
# a rerun after a failure carries on. Nothing here runs the night.
#
#   bash data/nightly/create-vm.sh
#   REJESTR_KEY=... bash data/nightly/create-vm.sh   # with the rejestr.io key
#   gcloud compute ssh koryta-nightly --zone=europe-central2-b --project=koryta-pl \
#     --command='sudo bash -s' < data/nightly/setup-vm.sh
#
# dev-workflow cannot run this: it gets 403 on IAM, Compute and Secret Manager.
set -euo pipefail

project=${PROJECT:-koryta-pl}
region=${REGION:-europe-central2}
zone=${ZONE:-europe-central2-b}
vm=${VM:-koryta-nightly}
# 4 vCPU / 32 GB: a full night peaks at 17.6-18.4 GB (2026-10-05, systemd's
# "memory peak") - every pipeline is rebuilt in one process and keeps its
# output until the end - so 16 GB is not enough. The extra cores help DuckDB
# and the odpis parser's process pool. $0.218/h against e2-highmem-2's $0.109.
machine=${MACHINE:-e2-highmem-4}
# versioned/ (~3 GB), the download cache, the venv, the odpis PDFs and memo.
disk_gb=${DISK_GB:-30}
sa_name=${SA_NAME:-koryta-nightly}
sa="$sa_name@$project.iam.gserviceaccount.com"
pesel_secret=${PESEL_SECRET:-koryta-pesel-salt}
web_key_secret=${WEB_KEY_SECRET:-firebase-web-api-key}
rejestr_secret=${REJESTR_SECRET:-rejestr-io-key}
schedule=${SCHEDULE:-koryta-nightly}
# The default network is in custom subnet mode, so a VM has to name its subnet;
# koryta-compressor and claude-dev use this one too, and default-allow-ssh
# lets gcloud compute ssh in.
subnet=${SUBNET:-default}

g() { gcloud --project="$project" --quiet "$@"; }

echo "== Service account $sa"
if ! g iam service-accounts describe "$sa" >/dev/null 2>&1; then
  g iam service-accounts create "$sa_name" --display-name="koryta nightly VM"
  # A new account takes a few seconds to be grantable.
  sleep 15
fi

echo "== Buckets"
# Read: the crawl, its compressed mirror, the pipeline backups and job logs.
for bucket in koryta-pl-crawled koryta-pl-compressed koryta-pl-sharedcache; do
  g storage buckets add-iam-policy-binding "gs://$bucket" \
    --member="serviceAccount:$sa" --role=roles/storage.objectViewer >/dev/null
done
# Add, never replace or delete: crawls are written create-only, backups, run
# summaries and mirror archives under new names.
for bucket in koryta-pl-crawled koryta-pl-compressed koryta-pl-sharedcache; do
  g storage buckets add-iam-policy-binding "gs://$bucket" \
    --member="serviceAccount:$sa" --role=roles/storage.objectCreator >/dev/null
done

echo "== /admin/procesy: write job runs to the ops database"
# IAM narrows Firestore to a database, not a collection: this account can
# write all of agent-tasks, the task list too (data/pipelines/src/jobs/README.md).
g projects add-iam-policy-binding "$project" --member="serviceAccount:$sa" \
  --role=roles/datastore.user \
  --condition="expression=resource.name==\"projects/$project/databases/agent-tasks\",title=agent-tasks-only" \
  >/dev/null

echo "== The people import signs in as pipeline-people-import"
# stores.koryta_login mints a Firebase custom token, which on a VM means
# signing with this account's own key through IAM: signBlob on itself.
g iam service-accounts add-iam-policy-binding "$sa" \
  --member="serviceAccount:$sa" --role=roles/iam.serviceAccountTokenCreator >/dev/null
g services enable iamcredentials.googleapis.com secretmanager.googleapis.com

echo "== Secrets: the PESEL key, the web key and the rejestr.io key"
# The same two the people import's Cloud Run runbook creates
# (data/pipelines/src/jobs/CLOUD_RUN.md): whichever runs first makes them.
# The PESEL key is the one that matters (task decide-pesel-key-in-secret-manager):
# KrsOdpisSeats fingerprints with it, and only the machine that holds it can add it.
if ! g secrets describe "$pesel_secret" >/dev/null 2>&1; then
  g secrets create "$pesel_secret" --replication-policy=automatic
fi
if ! g secrets versions list "$pesel_secret" --limit=1 --format='value(name)' | grep -q .; then
  if [[ -r "$HOME/.config/koryta/pesel-salt" ]]; then
    tr -d '\n' <"$HOME/.config/koryta/pesel-salt" |
      g secrets versions add "$pesel_secret" --data-file=-
  else
    cat <<EOF
!! $pesel_secret has no version yet. On the machine that holds the key:
   tr -d '\n' <~/.config/koryta/pesel-salt | gcloud secrets versions add $pesel_secret --project=$project --data-file=-
EOF
  fi
fi
if ! g secrets describe "$web_key_secret" >/dev/null 2>&1; then
  g secrets create "$web_key_secret" --replication-policy=automatic
  # From the site's own config, so it is the key the site uses.
  sed -n 's/.*apiKey: "\(AIza[^"]*\)".*/\1/p' "$(dirname "$0")/../../frontend/nuxt.config.ts" | tr -d '\n' |
    g secrets versions add "$web_key_secret" --data-file=-
fi
# The key the night's paid step buys from rejestr.io with
# (https://rejestr.io/konto/api). Without a version the step is skipped. A new
# version is fine here, unlike the PESEL key: night.sh reads `latest`.
if ! g secrets describe "$rejestr_secret" >/dev/null 2>&1; then
  g secrets create "$rejestr_secret" --replication-policy=automatic
fi
if ! g secrets versions list "$rejestr_secret" --limit=1 --format='value(name)' | grep -q .; then
  if [[ -n "${REJESTR_KEY:-}" ]]; then
    printf %s "$REJESTR_KEY" | g secrets versions add "$rejestr_secret" --data-file=-
  else
    cat <<EOF
!! $rejestr_secret has no version yet, so the night buys nothing from rejestr.io.
   With the key from https://rejestr.io/konto/api in REJESTR_KEY:
   printf %s "\$REJESTR_KEY" | gcloud secrets versions add $rejestr_secret --project=$project --data-file=-
EOF
  fi
fi
for secret in "$pesel_secret" "$web_key_secret" "$rejestr_secret"; do
  g secrets add-iam-policy-binding "$secret" \
    --member="serviceAccount:$sa" --role=roles/secretmanager.secretAccessor >/dev/null
done

echo "== VM $vm"
if ! g compute instances describe "$vm" --zone="$zone" >/dev/null 2>&1; then
  g compute instances create "$vm" --zone="$zone" \
    --machine-type="$machine" --subnet="$subnet" \
    --service-account="$sa" --scopes=cloud-platform \
    --image-family=debian-13 --image-project=debian-cloud \
    --boot-disk-size="${disk_gb}GB" --boot-disk-type=pd-balanced \
    --shielded-secure-boot --shielded-vtpm --shielded-integrity-monitoring \
    --labels=purpose=koryta-nightly
fi

echo "== Schedule $schedule: start 04:15, stop 09:00 (Warsaw)"
# Compute Engine's own agent starts and stops the VM, and attaching a schedule
# is refused until it may - so the grant comes first.
number=$(g projects describe "$project" --format='value(projectNumber)')
g projects add-iam-policy-binding "$project" \
  --member="serviceAccount:service-$number@compute-system.iam.gserviceaccount.com" \
  --role=roles/compute.instanceAdmin.v1 --condition=None >/dev/null
# The night follows the 04:00 Firestore export. A start may begin up to 15
# minutes late (the docs), so 04:15 is running by 04:30. The VM powers itself
# off when the night is over; the 09:00 stop only catches a night that hung.
g compute resource-policies describe "$schedule" --region="$region" >/dev/null 2>&1 ||
  g compute resource-policies create instance-schedule "$schedule" --region="$region" \
    --vm-start-schedule="15 4 * * *" --vm-stop-schedule="0 9 * * *" \
    --timezone=Europe/Warsaw --description="koryta nightly run"
attached() {
  g compute instances describe "$vm" --zone="$zone" --format='value(resourcePolicies)' |
    tr ';' '\n' | grep "/resourcePolicies/$schedule$" >/dev/null
}
# A fresh grant takes a minute or two to reach Compute, so the attach retries.
for attempt in 1 2 3 4 5 6; do
  attached && break
  g compute instances add-resource-policies "$vm" --zone="$zone" \
    --resource-policies="$schedule" && break
  if ((attempt == 6)); then
    echo "!! $schedule is not attached to $vm: the VM would never start on its own." >&2
    exit 1
  fi
  echo "Attaching $schedule failed (attempt $attempt); again in 30 s."
  sleep 30
done
attached && echo "$schedule is attached to $vm."

# The VM is running now. After setup-vm.sh, stop it (or let it be): the
# schedule boots it at 04:15 and the timer runs the night at 04:30 either way.
echo "Created. Next: setup-vm.sh (see the top of this file), then the README's first night."
