#!/bin/sh
# First installation or safe retry on a single Linux host. Run from a local clone.
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"

die() { printf '%s\n' "$*" >&2; exit 1; }
dc() { docker compose -f compose.yaml -f compose.local.yaml "$@"; }

[ -t 0 ] && [ -t 2 ] || die "Run this installer from an interactive terminal (for the administrator password)."
command -v docker >/dev/null 2>&1 || die "Install Docker Engine and Docker Compose first."
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is required."
docker info >/dev/null 2>&1 || die "Docker is not running or this account cannot access it."

if [ ! -e .env ]; then
  docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/setup" -w /setup \
    node:24.19.0-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df \
    node configure.mjs --bundled
fi
[ -f .env ] || die "Expected a regular .env file."
[ "$(stat -c %a .env)" = 600 ] || die ".env must have mode 600; run chmod 600 release/selfhost/.env."
grep -qx "S3_ENDPOINT='http://garage:3900'" .env || die "This installer only handles bundled storage. See README.md for an external S3 service."
grep -qx "DOCUMENT_BUCKET_NAME='documents'" .env || die "Bundled storage requires the original documents bucket name."
grep -qx "BACKUP_BUCKET_NAME='backups'" .env || die "Bundled storage requires the original backups bucket name."

printf '\nBuilding Personal Archive and starting private storage...\n'
dc config --quiet
dc build app
dc up -d postgres garage

ready=0
attempt=0
while [ "$attempt" -lt 90 ]; do
  if dc exec -T garage /garage bucket info documents >/dev/null 2>&1; then ready=1; break; fi
  attempt=$((attempt + 1))
  sleep 1
done
[ "$ready" -eq 1 ] || die "Garage did not initialize. Inspect docker compose logs garage without sharing secrets."
if ! dc exec -T garage /garage bucket info backups >/dev/null 2>&1; then
  dc exec -T garage /garage bucket create backups
fi
access_key=$(sed -n "s/^S3_ACCESS_KEY_ID='\(GK[0-9a-f]*\)'$/\1/p" .env)
[ -n "$access_key" ] || die "Bundled storage access key is missing from .env."
dc exec -T garage /garage bucket allow --read --write --key "$access_key" backups >/dev/null

printf '\nApplying database migrations...\n'
dc run --rm -T app node dist-server/migrate.mjs

set +e
dc run --rm -T app node dist-server/manage-users.mjs has-users
account_status=$?
set -e
case "$account_status" in
  0) printf 'An account already exists; keeping it unchanged.\n' ;;
  3)
    printf 'First administrator email: ' >&2
    IFS= read -r owner_email
    [ -n "$owner_email" ] || die "Email is required."
    printf 'Display name [Archive Owner]: ' >&2
    IFS= read -r owner_name
    owner_name=${owner_name:-Archive Owner}
    dc run --rm app node dist-server/init-admin.mjs --email "$owner_email" --name "$owner_name"
    ;;
  *) die "Could not inspect installed accounts. Nothing was reset." ;;
esac

dc up -d app
ready=0
attempt=0
while [ "$attempt" -lt 60 ]; do
  if dc exec -T app node -e "fetch('http://127.0.0.1:8080/readyz', {signal: AbortSignal.timeout(5000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then ready=1; break; fi
  attempt=$((attempt + 1))
  sleep 2
done
[ "$ready" -eq 1 ] || die "App started but is not ready. Check docker compose ps and logs without posting .env."
app_port=$(sed -n "s/^APP_PORT='\([0-9][0-9]*\)'$/\1/p" .env)
printf '\nPersonal Archive is ready at http://127.0.0.1:%s on this Linux host.\n' "${app_port:-8080}"
printf 'There is no default login. Use the administrator email and password you entered.\n'
printf 'To add household accounts later, run: sh release/selfhost/accounts.sh create --email person@example.org --name "Person"\n'
printf 'Keep .env and both PostgreSQL/Garage volumes backed up together before storing important files.\n'
