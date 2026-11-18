#!/bin/sh
# Bind the app to one private LAN address, or return it to host-only access.
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"

die() { printf '%s\n' "$*" >&2; exit 1; }
dc() { docker compose -f compose.yaml -f compose.local.yaml "$@"; }
private_ip() {
  printf '%s\n' "$1" | awk -F. '
    NF == 4 && $1 ~ /^[0-9]+$/ && $2 ~ /^[0-9]+$/ && $3 ~ /^[0-9]+$/ && $4 ~ /^[0-9]+$/ && $1 <= 255 && $2 <= 255 && $3 <= 255 && $4 <= 255 && ($1 == 10 || ($1 == 172 && $2 >= 16 && $2 <= 31) || ($1 == 192 && $2 == 168)) { valid = 1 }
    END { exit !valid }
  '
}

usage="Usage: sh release/selfhost/network.sh lan [PRIVATE_IPV4] | local"
[ "$#" -ge 1 ] && [ "$#" -le 2 ] || die "$usage"
mode=$1
case "$mode" in
  lan)
    if [ "$#" -eq 2 ]; then
      bind_address=$2
      private_ip "$bind_address" || die "Only a private LAN IPv4 address is allowed."
    else
      command -v ip >/dev/null 2>&1 || die "The ip command is required to detect a private LAN address. Supply one explicitly: network.sh lan 192.168.x.x"
      bind_address=$(ip -4 route get 1.1.1.1 2>/dev/null | sed -n 's/.* src \([0-9.]*\).*/\1/p' | head -n 1)
      if ! private_ip "$bind_address"; then
        bind_address=
        for candidate in $(ip -4 -o address show scope global | awk '$2 !~ /^(docker|br-|veth|virbr|cni|podman)/ { split($4, address, "/"); print address[1] }'); do
          if private_ip "$candidate"; then bind_address=$candidate; break; fi
        done
      fi
    fi
    private_ip "$bind_address" || die "No private LAN IPv4 address found. Supply one explicitly: sh release/selfhost/network.sh lan 192.168.x.x"
    ;;
  local)
    [ "$#" -eq 1 ] || die "$usage"
    bind_address=127.0.0.1
    ;;
  *) die "$usage" ;;
esac

[ -f .env ] && [ ! -L .env ] || die "Expected a regular release/selfhost/.env file."
[ "$(stat -c %a .env)" = 600 ] || die ".env must have mode 600."
existing_count=$(grep -c '^APP_BIND_ADDRESS=' .env || true)
[ "$existing_count" -le 1 ] || die ".env has duplicate APP_BIND_ADDRESS entries; resolve them before changing the bind address."
current=$(sed -n "s/^APP_BIND_ADDRESS='\([0-9.]*\)'$/\1/p" .env)
if [ "$current" = "$bind_address" ]; then
  printf 'Application already binds to %s.\n' "$bind_address"
  exit 0
fi

tmp=$(mktemp .env.network.XXXXXX)
trap 'rm -f "$tmp"' EXIT HUP INT TERM
chmod 600 "$tmp"
grep -v '^APP_BIND_ADDRESS=' .env > "$tmp"
printf "APP_BIND_ADDRESS='%s'\n" "$bind_address" >> "$tmp"
docker compose --env-file "$tmp" -f compose.yaml -f compose.local.yaml config --quiet
mv "$tmp" .env
trap - EXIT HUP INT TERM

if [ -n "$(dc ps -a -q app)" ]; then
  dc up -d --wait --no-deps app
fi
app_port=$(sed -n "s/^APP_PORT='\([0-9][0-9]*\)'$/\1/p" .env)
printf 'Application address: http://%s:%s\n' "$bind_address" "${app_port:-8080}"
