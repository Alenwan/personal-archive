#!/bin/sh
# Consistent, encrypted backup of a bundled PostgreSQL + single-node Garage install.
set -eu
caller_dir=$PWD
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
. ./recovery-lib.sh
umask 077

usage='Usage: sh release/selfhost/backup.sh --output /safe/location/archive.age [--recipient age1...]'
output_arg=
recipient=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --output) [ "$#" -ge 2 ] || pa_die "$usage"; output_arg=$2; shift 2 ;;
    --recipient) [ "$#" -ge 2 ] || pa_die "$usage"; recipient=$2; shift 2 ;;
    *) pa_die "$usage" ;;
  esac
done
[ -n "$output_arg" ] || pa_die "$usage"
if [ -n "$recipient" ]; then
  case "$recipient" in age1*) ;; *) pa_die "--recipient must be an age public key beginning with age1." ;; esac
fi
case "$output_arg" in *.age) ;; *) pa_die "Output filename must end in .age." ;; esac
case "$output_arg" in /*) ;; *) output_arg=$caller_dir/$output_arg ;; esac
out_dir=$(CDPATH= cd -- "$(dirname -- "$output_arg")" && pwd -P) || pa_die "Output directory does not exist."
out="$out_dir/$(basename -- "$output_arg")"
[ ! -e "$out" ] && [ ! -L "$out" ] || pa_die "Output already exists; backup never overwrites it."

pa_require_tools
pa_check_bundled_env .env
[ "$(stat -c %a .env)" = 600 ] || pa_die ".env must have mode 600."
pa_dc config --quiet
for service in postgres garage app; do
  [ -n "$(pa_dc ps --status running -q "$service")" ] || pa_die "All three services must be running; $service is not."
done
postgres_id=$(pa_dc ps -q postgres)
postgres_image=$(docker inspect -f '{{.Image}}' "$postgres_id")
garage_volume="${pa_project}_garage-data"
docker volume inspect "$garage_volume" >/dev/null 2>&1 || pa_die "Garage data volume is missing."
for bucket in documents backups; do
  pa_dc exec -T garage /garage bucket info "$bucket" >/dev/null 2>&1 || pa_die "Garage bucket $bucket is unavailable."
done

work=$(mktemp -d "${TMPDIR:-/var/tmp}/personal-archive-backup.XXXXXX")
stage="$work/files"
mkdir "$stage"
partial="$out_dir/.$(basename -- "$out").partial.$$"
app_stopped=0
garage_stopped=0
cleanup() {
  result=$?
  trap - EXIT HUP INT TERM
  if [ "$garage_stopped" -eq 1 ]; then pa_dc up -d garage >/dev/null || result=1; fi
  if [ "$app_stopped" -eq 1 ]; then pa_dc up -d app >/dev/null || result=1; fi
  rm -f "$partial"
  rm -rf "$work"
  if [ "$result" -ne 0 ]; then printf '%s\n' "Backup failed. Check docker compose ps; existing data was not removed." >&2; fi
  exit "$result"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

printf '%s\n' "Pausing the application while PostgreSQL and Garage are captured..."
pa_dc stop app >/dev/null
app_stopped=1
pa_dc exec -T postgres pg_dump -U archive -d archive -Fc > "$stage/database.dump"
pa_dc stop garage >/dev/null
garage_stopped=1
docker run --rm --network none --read-only \
  -v "$garage_volume:/source:ro" -v "$stage:/backup" \
  --entrypoint sh "$postgres_image" -c \
  "tar -C /source -cf /backup/garage-data.tar . && chown $(id -u):$(id -g) /backup/garage-data.tar"

pa_dc up -d garage >/dev/null
garage_stopped=0
pa_dc up -d app >/dev/null
pa_wait_ready
app_stopped=0

cp .env "$stage/.env"
cp ../../package.json "$stage/package.json"
cp compose.yaml compose.local.yaml garage.toml "$stage/"
source_commit=unknown
if command -v git >/dev/null 2>&1; then
  source_commit=$(git -C ../.. rev-parse HEAD 2>/dev/null || printf unknown)
fi
{
  printf 'format=1\n'
  printf 'created_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'source_commit=%s\n' "$source_commit"
  printf 'compose_project=%s\n' "$pa_project"
  printf 'postgres_image=%s\n' "$postgres_image"
} > "$stage/manifest.txt"
(cd "$stage" && sha256sum manifest.txt database.dump garage-data.tar .env package.json compose.yaml compose.local.yaml garage.toml > SHA256SUMS)
tar -C "$stage" -cf "$work/payload.tar" manifest.txt SHA256SUMS database.dump garage-data.tar .env package.json compose.yaml compose.local.yaml garage.toml
if [ -n "$recipient" ]; then
  printf '%s\n' "Services resumed. Encrypting for the supplied age recipient..."
  age -r "$recipient" -o "$partial" "$work/payload.tar"
else
  printf '%s\n' "Services resumed. Encrypting the backup; enter a strong backup passphrase twice."
  age -p -o "$partial" "$work/payload.tar"
fi
ln "$partial" "$out" || pa_die "Output appeared during backup; refusing to overwrite it."
rm -f "$partial"
printf 'Encrypted backup: %s\n' "$out"
if [ -n "$recipient" ]; then
  printf '%s\n' "Keep the private age identity off this host, run verify-backup.sh, and move a copy of the archive off this host."
else
  printf '%s\n' "Keep the passphrase separately, run verify-backup.sh, and move a copy off this host."
fi
