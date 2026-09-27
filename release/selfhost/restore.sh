#!/bin/sh
# Recover only into a new, empty Compose project; never overwrite an installation.
set -eu
caller_dir=$PWD
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
. ./recovery-lib.sh
umask 077

usage='Usage: sh release/selfhost/restore.sh --archive /path/to/archive.age [--identity /path/to/age-key.txt] [--project-name isolated-name] [--app-port 8081]'
[ "$#" -ge 2 ] || pa_die "$usage"
[ "$1" = --archive ] || pa_die "$usage"
archive_arg=$2
case "$archive_arg" in /*) ;; *) archive_arg=$caller_dir/$archive_arg ;; esac
shift 2
new_project=
new_port=
identity=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --identity) [ "$#" -ge 2 ] || pa_die "$usage"; identity=$2; shift 2 ;;
    --project-name) [ "$#" -ge 2 ] || pa_die "$usage"; new_project=$2; shift 2 ;;
    --app-port) [ "$#" -ge 2 ] || pa_die "$usage"; new_port=$2; shift 2 ;;
    *) pa_die "$usage" ;;
  esac
done
if [ -n "$identity" ]; then
  case "$identity" in /*) ;; *) identity=$caller_dir/$identity ;; esac
  [ -f "$identity" ] && [ ! -L "$identity" ] || pa_die "Expected a regular age identity file."
fi
[ -f "$archive_arg" ] && [ ! -L "$archive_arg" ] || pa_die "Expected a regular encrypted backup file."
archive=$(CDPATH= cd -- "$(dirname -- "$archive_arg")" && pwd -P)/$(basename -- "$archive_arg")
[ ! -e .env ] && [ ! -L .env ] || pa_die "This checkout already has .env; restore requires a fresh checkout."
pa_require_tools
work=$(mktemp -d "${TMPDIR:-/var/tmp}/personal-archive-restore.XXXXXX")
app_started=0
cleanup() {
  result=$?
  trap - EXIT HUP INT TERM
  if [ "$result" -ne 0 ] && [ "$app_started" -eq 1 ]; then pa_dc stop app >/dev/null 2>&1 || true; fi
  rm -rf "$work"
  if [ "$result" -ne 0 ]; then printf '%s\n' "Restore failed. Any newly created data is retained for inspection; do not run install.sh over it." >&2; fi
  exit "$result"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
pa_unpack_and_verify "$archive" "$work" "$identity"

cmp -s "$work/package.json" ../../package.json || pa_die "Source package.json differs from the backed-up version."
for file in compose.yaml compose.local.yaml garage.toml; do
  cmp -s "$work/$file" "$file" || pa_die "Source $file differs from the backed-up version."
done
saved_commit=$(pa_manifest_value source_commit "$work")
if [ "$saved_commit" != unknown ]; then
  command -v git >/dev/null 2>&1 || pa_die "Git is needed to check the backed-up source commit."
  current_commit=$(git -C ../.. rev-parse HEAD 2>/dev/null || printf unknown)
  [ "$saved_commit" = "$current_commit" ] || pa_die "Checkout source commit $saved_commit before restoring."
fi

if [ -n "$new_project" ]; then
  pa_valid_project "$new_project" || pa_die "Project name must contain only lowercase letters, numbers and hyphens."
  sed "s/^COMPOSE_PROJECT_NAME=.*/COMPOSE_PROJECT_NAME='$new_project'/" "$work/.env" > "$work/new.env"
  mv "$work/new.env" "$work/.env"
fi
if [ -n "$new_port" ]; then
  case "$new_port" in ''|*[!0-9]*) pa_die "App port must be a number." ;; esac
  [ "$new_port" -ge 1 ] && [ "$new_port" -le 65535 ] || pa_die "App port must be between 1 and 65535."
  sed "s/^APP_PORT=.*/APP_PORT='$new_port'/" "$work/.env" > "$work/new.env"
  mv "$work/new.env" "$work/.env"
fi
pa_check_bundled_env "$work/.env"
project=$pa_project
for volume in "${project}_postgres-data" "${project}_garage-data"; do
  ! docker volume inspect "$volume" >/dev/null 2>&1 || pa_die "Volume $volume already exists; refusing to overwrite it."
done
[ -z "$(docker ps -aq --filter "label=com.docker.compose.project=$project")" ] || pa_die "Compose project $project already has containers."
! docker network inspect "${project}_default" >/dev/null 2>&1 || pa_die "Compose project $project already has a network."
docker compose --env-file "$work/.env" -f compose.yaml -f compose.local.yaml config --quiet

cp "$work/.env" .env
chmod 600 .env
printf 'Restoring into new Compose project %s...\n' "$project"
pa_dc up -d postgres
postgres_id=$(pa_dc ps -q postgres)
[ -n "$postgres_id" ] || pa_die "PostgreSQL did not start."
postgres_image=$(docker inspect -f '{{.Image}}' "$postgres_id")
garage_volume="${project}_garage-data"
if ! docker volume inspect "$garage_volume" >/dev/null 2>&1; then
  docker volume create --label "com.docker.compose.project=$project" --label com.docker.compose.volume=garage-data "$garage_volume" >/dev/null
fi
docker run --rm --network none --read-only \
  -v "$garage_volume:/destination" -v "$work:/backup:ro" \
  --entrypoint sh "$postgres_image" -c 'tar -C /destination -xf /backup/garage-data.tar'
pa_dc exec -T postgres pg_restore --no-owner --no-acl --exit-on-error -U archive -d archive < "$work/database.dump"
pa_dc up -d garage
pa_dc up -d app
app_started=1
pa_wait_ready
printf 'Restore ready at http://127.0.0.1:%s\n' "$(pa_env_value APP_PORT .env)"
printf '%s\n' "Sign in with a restored account and check representative files, notes, writing and vault access."
