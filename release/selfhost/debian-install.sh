#!/bin/sh
# Fresh Debian 12/13 host bootstrap. Run from an interactive root shell.
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"

die() { printf '%s\n' "$*" >&2; exit 1; }
[ "$(id -u)" -eq 0 ] || die "Run as root: sudo sh release/selfhost/debian-install.sh"
[ -t 0 ] && [ -t 2 ] || die "Run in an interactive terminal to create the first administrator."
[ -r /etc/os-release ] || die "Cannot identify the operating system."
. /etc/os-release
[ "$ID" = debian ] || die "This bootstrap is for Debian 12 or 13 only."
case "$VERSION_ID" in 12|13) ;; *) die "Debian $VERSION_ID is not in this bootstrap's supported list." ;; esac
command -v apt-get >/dev/null 2>&1 || die "apt-get is required."

if command -v docker >/dev/null 2>&1; then
  docker compose version >/dev/null 2>&1 || die "Docker is installed without Compose v2. Install the Compose plugin using Docker's Debian guide."
  docker info >/dev/null 2>&1 || die "Docker is installed but its daemon is unavailable. Start it and retry."
  printf 'Using the existing Docker Engine and Compose installation.\n'
else
  # A fresh host can be bootstrapped safely. Existing alternative runtimes
  # require an operator decision; this script never removes packages.
  for package in docker.io docker-compose docker-doc docker-buildx podman-docker containerd runc; do
    if dpkg-query -W -f='${Status}' "$package" 2>/dev/null | grep -qx 'install ok installed'; then
      die "Conflicting package $package is installed. Follow https://docs.docker.com/engine/install/debian/ before retrying."
    fi
  done
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  cat > /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/debian
Suites: $VERSION_CODENAME
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
  docker compose version >/dev/null 2>&1 || die "Docker Compose installation failed."
  docker info >/dev/null 2>&1 || die "Docker daemon did not start."
fi

if ! command -v age >/dev/null 2>&1; then
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y age
fi

compose_version=$(docker compose version --short | sed 's/^v//')
compose_major=${compose_version%%.*}
compose_tail=${compose_version#*.}
compose_minor=${compose_tail%%.*}
case "$compose_major:$compose_minor" in *[!0-9:]*|:*|*:) die "Cannot read the Docker Compose version." ;; esac
if [ "$compose_major" -lt 2 ] || { [ "$compose_major" -eq 2 ] && [ "$compose_minor" -lt 24 ]; }; then
  die "Docker Compose v2.24 or later is required; found $compose_version."
fi

printf '\nInstalling Personal Archive with bundled private storage...\n'
sh ./install.sh
printf '\nFor encrypted backups, run: sudo sh release/selfhost/backup.sh --output /safe/path/archive.age\n'
