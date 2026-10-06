#!/usr/bin/env bash
# Prepare the koryta-nightly VM: packages, the koryta user, uv, Go, the
# checkout, /etc/koryta/nightly.env and the systemd unit. Idempotent - run it
# again after changing anything it installs (the unit above all). As root on
# the VM, from the machine that created it:
#
#   gcloud compute ssh koryta-nightly --zone=europe-central2-b --project=koryta-pl \
#     --command='sudo bash -s' < data/nightly/setup-vm.sh
#
# It sets up from the code the nights run: KORYTA_REF in /etc/koryta/nightly.env,
# or origin/main. To try a branch nobody has merged yet, name it on the first
# run - `--command='sudo env KORYTA_REF=origin/<branch> bash -s'` - and the new
# nightly.env runs that branch every night until its KORYTA_REF is changed back.
#
# It does not run the night. The first night after it is a cold one: the
# download cache and versioned/ are empty, so expect it to take longer.
set -euo pipefail

repo_url=${REPO_URL:-https://github.com/SzymonPajzert/koryta.git}
env_file=/etc/koryta/nightly.env
running_ref=$(sed -n 's/^KORYTA_REF=//p' "$env_file" 2>/dev/null || true)
ref=${KORYTA_REF:-${running_ref:-origin/main}}
# At least go.mod's `go` directive (data/compressor/go.mod).
go_version=${GO_VERSION:-1.25.1}
user=koryta
home=/home/$user
repo=$home/koryta

export DEBIAN_FRONTEND=noninteractive
apt-get update -q
# libpq-dev: pytest-postgresql, in the test group, needs libpq to load at all.
apt-get install -y -q --no-install-recommends \
  ca-certificates curl git jq libpq-dev build-essential unattended-upgrades

# Security updates install themselves; the VM boots every night, so a new
# kernel is running by the next one.
cat >/etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF

if ! command -v gcloud >/dev/null; then
  echo "gcloud is missing - the Google Cloud CLI comes with GCE's Debian images; install google-cloud-cli first." >&2
  exit 1
fi

id -u "$user" >/dev/null 2>&1 || useradd --create-home --shell /bin/bash "$user"

# The reprocess peaks around 5 GB and has hit 11 GB when a pin was missing;
# swap turns that into slowness rather than an OOM kill.
if [[ ! -e /swapfile ]]; then
  fallocate -l 4G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  echo '/swapfile none swap sw 0 0' >>/etc/fstab
  swapon /swapfile
fi

mkdir -p /etc/systemd/journald.conf.d
printf '[Journal]\nSystemMaxUse=1G\n' >/etc/systemd/journald.conf.d/koryta.conf
systemctl restart systemd-journald

if [[ ! -x /usr/local/go/bin/go ]] || ! /usr/local/go/bin/go version | grep -q "go$go_version "; then
  rm -rf /usr/local/go
  curl -fsSL "https://go.dev/dl/go$go_version.linux-amd64.tar.gz" | tar -C /usr/local -xz
fi

as_user() { sudo -u "$user" -H bash -c "$1"; }
as_user 'command -v ~/.local/bin/uv >/dev/null || curl -LsSf https://astral.sh/uv/install.sh | sh'
as_user "[[ -d $repo/.git ]] || git clone --quiet $repo_url $repo"
# What night.sh does at the start of every night; the units below and the
# environment come from this checkout.
as_user "git -C $repo fetch --quiet --prune origin && git -C $repo checkout --quiet --force --detach '$ref'"
echo "Code: $ref, $(as_user "git -C $repo log -1 --format='%h %s'")"

install -d -m 0755 /etc/koryta
if [[ ! -e "$env_file" ]]; then
  install -m 0644 "$repo/data/nightly/nightly.env.example" "$env_file"
  sed -i "s|^KORYTA_REF=.*|KORYTA_REF=$ref|" "$env_file"
  echo "Wrote $env_file from the example (KORYTA_REF=$ref) - read it before the first night."
elif [[ "$running_ref" != "$ref" ]]; then
  echo "!! The nights run KORYTA_REF=$running_ref, not $ref: edit $env_file if they should run $ref too."
fi

for unit in koryta-nightly.service koryta-nightly.timer; do
  install -m 0644 "$repo/data/nightly/$unit" "/etc/systemd/system/$unit"
done
systemctl daemon-reload
# The timer, not the service: the service has no [Install] and runs only when
# the timer (or somebody) starts it.
systemctl enable --now koryta-nightly.timer

# The environment, now rather than in the first night's budget.
as_user "cd $repo/data/pipelines && ~/.local/bin/uv sync --frozen --no-default-groups --group test"
install -d -o "$user" -g "$user" /var/lib/koryta-nightly /var/lib/koryta-nightly/bin
as_user "cd $repo/data/compressor && /usr/local/go/bin/go build -o /var/lib/koryta-nightly/bin/compressor ./cmd/compressor"

systemctl list-timers koryta-nightly.timer --no-pager
echo "Done. The night runs at 04:30 Warsaw - see data/nightly/README.md for the first one."
