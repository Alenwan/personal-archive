#!/bin/sh
# Disposable Linux/Docker integration exercise. Never run against an installed instance.
set -eu
[ "${PA_RECOVERY_TEST_ALLOW:-}" = 1 ] || { printf '%s\n' 'Set PA_RECOVERY_TEST_ALLOW=1 on a disposable Docker host.' >&2; exit 1; }
repo=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
[ ! -e "$repo/release/selfhost/.env" ] || { printf '%s\n' 'Run from a clean source checkout, not an installed instance.' >&2; exit 1; }
for tool in git docker age age-keygen curl jq sha256sum; do command -v "$tool" >/dev/null 2>&1 || { printf 'Missing %s\n' "$tool" >&2; exit 1; }; done
work=$(mktemp -d "${TMPDIR:-/var/tmp}/personal-archive-recovery-test.XXXXXX")
source_dir="$work/source"
restored_dir="$work/restored"
cleanup() {
  result=$?
  trap - EXIT HUP INT TERM
  if [ -f "$restored_dir/release/selfhost/.env" ]; then
    (cd "$restored_dir/release/selfhost" && docker compose -f compose.yaml -f compose.local.yaml down --volumes) >/dev/null 2>&1 || true
  fi
  if [ -f "$source_dir/release/selfhost/.env" ]; then
    (cd "$source_dir/release/selfhost" && docker compose -f compose.yaml -f compose.local.yaml down --volumes) >/dev/null 2>&1 || true
  fi
  rm -rf "$work"
  exit "$result"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

git clone --quiet --no-hardlinks "$repo" "$source_dir"
git clone --quiet --no-hardlinks "$repo" "$restored_dir"
source_dc() { (cd "$source_dir/release/selfhost" && docker compose -f compose.yaml -f compose.local.yaml "$@"); }
printf 'Synthetic recovery fixture\n' > "$work/original.txt"
age-keygen -o "$work/identity.txt" >/dev/null 2>&1
recipient=$(age-keygen -y "$work/identity.txt")

(cd "$source_dir/release/selfhost" && docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/setup" -w /setup \
  node:24.19.0-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df \
  node configure.mjs --bundled)
source_dc build app
source_dc up -d postgres garage
attempt=0
until source_dc exec -T garage /garage bucket info documents >/dev/null 2>&1; do
  attempt=$((attempt + 1)); [ "$attempt" -lt 90 ] || { printf '%s\n' 'Garage did not start.' >&2; exit 1; }; sleep 1
done
source_dc exec -T garage /garage bucket create backups
access_key=$(sed -n "s/^S3_ACCESS_KEY_ID='\(GK[0-9a-f]*\)'$/\1/p" "$source_dir/release/selfhost/.env")
[ -n "$access_key" ]
source_dc exec -T garage /garage bucket allow --read --write --key "$access_key" backups >/dev/null
source_dc run --rm -T app node dist-server/migrate.mjs
printf 'SyntheticPass1234\n' | source_dc run --rm -T app node dist-server/init-admin.mjs \
  --email recovery@example.invalid --name 'Recovery Test' --password-stdin
source_dc up -d app
attempt=0
until curl -fsS http://127.0.0.1:8080/readyz >/dev/null; do
  attempt=$((attempt + 1)); [ "$attempt" -lt 60 ] || { printf '%s\n' 'Source app did not become ready.' >&2; exit 1; }; sleep 2
done
curl -fsS -c "$work/source.cookies" -H 'content-type: application/json' \
  -d '{"email":"recovery@example.invalid","password":"SyntheticPass1234"}' \
  http://127.0.0.1:8080/api/auth/login | jq -e '.user' >/dev/null
document=$(curl -fsS -b "$work/source.cookies" -F "file=@$work/original.txt;type=text/plain" \
  -F 'category=Other' http://127.0.0.1:8080/api/documents)
document_id=$(printf '%s' "$document" | jq -r '.documentId')
[ "$document_id" != null ] && [ -n "$document_id" ]
note=$(curl -fsS -b "$work/source.cookies" -H 'content-type: application/json' \
  -d '{"title":"Recovery note","type":"Reference","body":"note marker"}' \
  http://127.0.0.1:8080/api/knowledge)
note_id=$(printf '%s' "$note" | jq -r '.knowledgeId')
work_record=$(curl -fsS -b "$work/source.cookies" -H 'content-type: application/json' \
  -d '{"title":"Recovery work"}' http://127.0.0.1:8080/api/manuscripts)
work_id=$(printf '%s' "$work_record" | jq -r '.manuscriptId')
chapter=$(curl -fsS -b "$work/source.cookies" -H 'content-type: application/json' \
  -d '{"title":"Recovery chapter","body":"# chapter marker","contentFormat":"markdown"}' \
  "http://127.0.0.1:8080/api/manuscripts/$work_id/chapters")
chapter_id=$(printf '%s' "$chapter" | jq -r '.chapterId')
run=$(curl -fsS -b "$work/source.cookies" -H 'content-type: application/json' \
  -d '{"destination":"r2-manifest","scope":"all-cases","includeMetadata":true,"includeDocuments":true,"includeAuditLogs":true,"includeRelationshipMap":false,"folderByCaseAndCategory":false,"checksumManifest":true}' \
  http://127.0.0.1:8080/api/backups/runs)
run_id=$(printf '%s' "$run" | jq -r '.backupRunId')
[ "$run_id" != null ] && [ -n "$run_id" ]
curl -fsS -b "$work/source.cookies" "http://127.0.0.1:8080/api/backups/runs/$run_id/manifest" -o "$work/source-manifest.json"

sh "$source_dir/release/selfhost/backup.sh" --output "$work/backup.age" --recipient "$recipient"
sh "$source_dir/release/selfhost/verify-backup.sh" "$work/backup.age" --identity "$work/identity.txt"
if sh "$source_dir/release/selfhost/restore.sh" --archive "$work/backup.age" --identity "$work/identity.txt" >/dev/null 2>&1; then
  printf '%s\n' 'Restore incorrectly accepted a populated checkout.' >&2; exit 1
fi
head -c 24 "$work/backup.age" > "$work/broken.age"
if sh "$source_dir/release/selfhost/verify-backup.sh" "$work/broken.age" --identity "$work/identity.txt" >/dev/null 2>&1; then
  printf '%s\n' 'Verifier incorrectly accepted a truncated archive.' >&2; exit 1
fi

rehearsal="archive-recovery-test-$(date +%s)-$$"
sh "$restored_dir/release/selfhost/restore.sh" --archive "$work/backup.age" \
  --identity "$work/identity.txt" --project-name "$rehearsal" --app-port 8081
curl -fsS http://127.0.0.1:8081/healthz | jq -e '.ok == true' >/dev/null
curl -fsS http://127.0.0.1:8081/readyz | jq -e '.ok == true' >/dev/null
curl -fsS -c "$work/restored.cookies" -H 'content-type: application/json' \
  -d '{"email":"recovery@example.invalid","password":"SyntheticPass1234"}' \
  http://127.0.0.1:8081/api/auth/login | jq -e '.user' >/dev/null
curl -fsS -b "$work/restored.cookies" "http://127.0.0.1:8081/api/documents/$document_id/download" \
  -o "$work/restored.txt"
cmp "$work/original.txt" "$work/restored.txt"
curl -fsS -b "$work/restored.cookies" "http://127.0.0.1:8081/api/knowledge/$note_id" \
  | jq -e '.body == "note marker"' >/dev/null
curl -fsS -b "$work/restored.cookies" "http://127.0.0.1:8081/api/manuscripts/$work_id/chapters/$chapter_id" \
  | jq -e '.body == "# chapter marker"' >/dev/null
curl -fsS -b "$work/restored.cookies" "http://127.0.0.1:8081/api/backups/runs/$run_id/manifest" \
  -o "$work/restored-manifest.json"
cmp "$work/source-manifest.json" "$work/restored-manifest.json"
printf '%s\n' 'Synthetic PostgreSQL + both Garage buckets restored and read successfully.'
