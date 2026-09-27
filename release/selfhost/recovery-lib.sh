#!/bin/sh
# Shared, intentionally small helpers for the bundled one-host recovery commands.
set -eu

pa_die() { printf '%s\n' "$*" >&2; exit 1; }
pa_need() { command -v "$1" >/dev/null 2>&1 || pa_die "Missing $1. Install it before continuing."; }
pa_dc() { docker compose -f compose.yaml -f compose.local.yaml "$@"; }

pa_env_value() {
  sed -n "s/^$1='\([^']*\)'$/\1/p" "$2"
}

pa_valid_project() {
  case "$1" in
    ''|-*|*[!a-z0-9-]*) return 1 ;;
    *) return 0 ;;
  esac
}

pa_check_bundled_env() {
  [ -f "$1" ] && [ ! -L "$1" ] || pa_die "Expected a regular .env file."
  grep -qx "S3_ENDPOINT='http://garage:3900'" "$1" || pa_die "Recovery commands support the bundled Garage installation only."
  grep -qx "DOCUMENT_BUCKET_NAME='documents'" "$1" || pa_die "The documents bucket does not match the bundled installation."
  grep -qx "BACKUP_BUCKET_NAME='backups'" "$1" || pa_die "The backups bucket does not match the bundled installation."
  pa_project=$(pa_env_value COMPOSE_PROJECT_NAME "$1")
  pa_valid_project "$pa_project" || pa_die "Invalid Compose project name in .env."
}

pa_require_tools() {
  pa_need age
  pa_need docker
  pa_need sha256sum
  pa_need tar
  pa_need awk
  docker compose version >/dev/null 2>&1 || pa_die "Docker Compose v2 is required."
  docker info >/dev/null 2>&1 || pa_die "Docker is unavailable to this account."
}

pa_wait_ready() {
  ready=0
  attempt=0
  while [ "$attempt" -lt 60 ]; do
    if pa_dc exec -T app node -e "fetch('http://127.0.0.1:8080/readyz', {signal: AbortSignal.timeout(5000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then ready=1; break; fi
    attempt=$((attempt + 1))
    sleep 2
  done
  [ "$ready" -eq 1 ] || pa_die "Application did not become ready."
}

pa_unpack_and_verify() {
  # The encrypted archive is decrypted only inside a mode-0700 temporary directory.
  if [ -n "${3:-}" ]; then
    age -d -i "$3" -o "$2/payload.tar" "$1" || pa_die "Could not decrypt backup."
  else
    age -d -o "$2/payload.tar" "$1" || pa_die "Could not decrypt backup."
  fi
  expected=$(printf '%s\n' manifest.txt SHA256SUMS database.dump garage-data.tar .env package.json compose.yaml compose.local.yaml garage.toml)
  actual=$(tar -tf "$2/payload.tar") || pa_die "Backup is not a readable tar archive."
  [ "$actual" = "$expected" ] || pa_die "Backup contains an unexpected or missing member."
  tar -tvf "$2/payload.tar" | awk 'substr($0,1,1)!="-" { bad=1 } END { exit bad }' || pa_die "Backup contains a non-regular member."
  tar --no-same-owner --no-same-permissions -C "$2" -xf "$2/payload.tar"
  for file in manifest.txt SHA256SUMS database.dump garage-data.tar .env package.json compose.yaml compose.local.yaml garage.toml; do
    [ -f "$2/$file" ] && [ ! -L "$2/$file" ] || pa_die "Backup member $file is not a regular file."
  done
  (cd "$2" && sha256sum -c SHA256SUMS >/dev/null) || pa_die "Backup checksum verification failed."
  grep -qx 'format=1' "$2/manifest.txt" || pa_die "Unsupported backup format."
  [ -s "$2/database.dump" ] && [ -s "$2/garage-data.tar" ] || pa_die "Backup data is empty."
  tar -tf "$2/garage-data.tar" > "$2/garage-list.txt" || pa_die "Garage data archive is invalid."
  awk '$0 !~ /^\.\// || $0 ~ /(^|\/)\.\.(\/|$)/ { bad=1 } END { exit bad }' "$2/garage-list.txt" || pa_die "Garage data archive has an unsafe path."
  tar -tvf "$2/garage-data.tar" | awk 'substr($0,1,1)!="-" && substr($0,1,1)!="d" { bad=1 } END { exit bad }' || pa_die "Garage data archive has an unsafe member type."
  pa_check_bundled_env "$2/.env"
}

pa_manifest_value() {
  sed -n "s/^$1=//p" "$2/manifest.txt"
}
