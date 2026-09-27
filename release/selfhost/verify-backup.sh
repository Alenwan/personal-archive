#!/bin/sh
# Validate backup contents and checksums without contacting Docker or changing data.
set -eu
caller_dir=$PWD
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
. ./recovery-lib.sh
umask 077

usage='Usage: sh release/selfhost/verify-backup.sh /path/to/archive.age [--identity /path/to/age-key.txt]'
[ "$#" -ge 1 ] || pa_die "$usage"
archive_arg=$1
shift
identity=
if [ "$#" -gt 0 ]; then
  [ "$#" -eq 2 ] && [ "$1" = --identity ] || pa_die "$usage"
  identity=$2
fi
case "$archive_arg" in /*) ;; *) archive_arg=$caller_dir/$archive_arg ;; esac
if [ -n "$identity" ]; then
  case "$identity" in /*) ;; *) identity=$caller_dir/$identity ;; esac
  [ -f "$identity" ] && [ ! -L "$identity" ] || pa_die "Expected a regular age identity file."
fi
[ -f "$archive_arg" ] && [ ! -L "$archive_arg" ] || pa_die "Expected a regular encrypted backup file."
archive=$(CDPATH= cd -- "$(dirname -- "$archive_arg")" && pwd -P)/$(basename -- "$archive_arg")
pa_need age
pa_need sha256sum
pa_need tar
work=$(mktemp -d "${TMPDIR:-/var/tmp}/personal-archive-verify.XXXXXX")
trap 'rm -rf "$work"' EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
pa_unpack_and_verify "$archive" "$work" "$identity"
printf 'Backup verified: %s\n' "$archive"
printf 'Created: %s\n' "$(pa_manifest_value created_utc "$work")"
printf 'Source commit: %s\n' "$(pa_manifest_value source_commit "$work")"
printf '%s\n' "Checksums and archive structure passed. A separate restore exercise is still required."
