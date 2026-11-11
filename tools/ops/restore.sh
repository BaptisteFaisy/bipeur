#!/usr/bin/env bash
# Restore a Beeper backup archive produced by tools/ops/backup.sh.
#
# Restores into a target directory, never over a live database: the caller
# decides where the files go, so this script is equally usable for a real
# recovery (target = the data directory of a stopped Central) and for the
# automated proof in tools/ops/verify-restore.sh (target = a temp directory).
#
# The archive's sha256 is checked before anything is written, and the restored
# database is opened and integrity-checked afterwards, so "restored" here always
# means "restored and proven to open".
#
# Usage:
#   tools/ops/restore.sh --archive PATH --target DIR [--node PATH] [--force]
set -euo pipefail

ARCHIVE=""
TARGET=""
NODE="${BIPEUR_NODE:-node}"
FORCE=0

log() { printf '[restore %s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die() { printf '[restore] ERROR: %s\n' "$*" >&2; exit 1; }

parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --archive) ARCHIVE="$2"; shift 2 ;;
      --target) TARGET="$2"; shift 2 ;;
      --node) NODE="$2"; shift 2 ;;
      --force) FORCE=1; shift ;;
      -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
      *) die "unknown argument: $1" ;;
    esac
  done
  [ -n "$ARCHIVE" ] && [ -f "$ARCHIVE" ] || die "archive not found: ${ARCHIVE:-<empty>}"
  [ -n "$TARGET" ] || die "--target is required"
}

check_sum() {
  local sidecar="$ARCHIVE.sha256"
  if [ ! -f "$sidecar" ]; then
    log "no sha256 sidecar next to the archive, skipping the sum check"
    return 0
  fi
  ( cd "$(dirname "$ARCHIVE")" && sha256sum -c "$(basename "$sidecar")" >/dev/null ) \
    || die "sha256 mismatch — the archive is corrupt or was modified"
  log "sha256 verified"
}

extract() {
  if [ -e "$TARGET" ] && [ -n "$(ls -A "$TARGET" 2>/dev/null)" ] && [ "$FORCE" != 1 ]; then
    die "target $TARGET is not empty (use --force to overwrite)"
  fi
  mkdir -p "$TARGET"
  tar -xzf "$ARCHIVE" -C "$TARGET"
  [ -f "$TARGET/bipeur.sqlite" ] || die "the archive contains no bipeur.sqlite"
  log "extracted to $TARGET: $(ls -A "$TARGET" | tr '\n' ' ')"
}

prove_it_opens() {
  RESTORE_DB="$TARGET/bipeur.sqlite" "$NODE" --disable-warning=ExperimentalWarning - <<'NODE_EOF'
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(process.env.RESTORE_DB, { readOnly: true });
const integrity = db.prepare('PRAGMA integrity_check').all().map((r) => Object.values(r)[0]);
const count = (t) => {
  try { return Number(db.prepare(`SELECT count(*) AS n FROM "${t}"`).get().n); } catch { return 0; }
};
console.log(`[restore] opened: integrity=${integrity.join(',')} pages=${count('pages')} events=${count('events')}`);
if (integrity.join(',') !== 'ok') process.exit(1);
NODE_EOF
}

show_manifest() {
  [ -f "$TARGET/MANIFEST.json" ] || return 0
  python3 -c 'import json,sys
m=json.load(open(sys.argv[1]))
print("[restore] manifest: taken_at=%s host=%s commit=%s pages=%s events=%s last_event=%s" % (
  m.get("taken_at"), m.get("host"), str(m.get("repo_commit"))[:8],
  m.get("counts", {}).get("pages"), m.get("counts", {}).get("events"),
  (m.get("last_event") or {}).get("id")))' "$TARGET/MANIFEST.json"
}

main() {
  parse_args "$@"
  check_sum
  extract
  prove_it_opens
  show_manifest
  log "DONE $TARGET/bipeur.sqlite"
}

main "$@"
