#!/bin/sh
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
[ -f .env ] || { printf '%s\n' "Install Personal Archive first." >&2; exit 1; }
if grep -qx "S3_ENDPOINT='http://garage:3900'" .env; then
  exec docker compose -f compose.yaml -f compose.local.yaml run --rm app node dist-server/manage-users.mjs "$@"
fi
exec docker compose -f compose.yaml run --rm app node dist-server/manage-users.mjs "$@"
