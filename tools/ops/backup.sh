#!/usr/bin/env bash
# Consistent, verified, rotating backup of the Beeper Central database.
#
# Why this script exists: "backup = copy the file" (BIP-N-09) is not a backup.
# Measured on the production host on 2026-11-11, data/bipeur.sqlite was 4 096
# bytes while data/bipeur.sqlite-wal held 1 034 152 bytes: every row written
# since the last checkpoint lives in the WAL. A plain `cp` of the .sqlite file
# produced a copy with ZERO tables (proved with tools/ops/sqlite-snapshot.mjs),
# i.e. restoring it would lose the whole instance.
#
# So the snapshot goes through SQLite's Online Backup API (see
# tools/ops/sqlite-snapshot.mjs), which is safe while the service writes, and
# the archive is verified: integrity_check on the snapshot, sha256 re-read from
# the archive, member list checked.
#
# Retention is bounded but never total: the oldest archives beyond --keep are
# removed one by one (logged, never `rm -rf` on a directory), and at least
# MIN_REMAINING archives always survive, whatever --keep says.
#
# Storage: outside the clone by default ($HOME/bipeur-backups). The r630 has a
# single disk, so a local copy does not survive a disk loss — pass --replica
# user@host:dir to also push each archive over the tailnet to another machine
# (the workstation is the obvious one; see docs/OPERATIONS.md).
#
# Usage:
#   tools/ops/backup.sh [--db PATH] [--dest DIR] [--keep N] [--replica U@H:DIR]
#                       [--node PATH] [--repo DIR] [--dry-run]
set -euo pipefail

REPO="${BIPEUR_REPO:-$HOME/bipeur-demo}"
DB="${BIPEUR_DB:-$REPO/data/bipeur.sqlite}"
DEST="${BIPEUR_BACKUP_DIR:-$HOME/bipeur-backups}"
KEEP="${BIPEUR_BACKUP_KEEP:-14}"
REPLICA="${BIPEUR_BACKUP_REPLICA:-}"
MIN_FREE_MB="${BIPEUR_BACKUP_MIN_FREE_MB:-200}"
NODE="${BIPEUR_NODE:-node}"
SERVICE="${BIPEUR_SERVICE:-bipeur-central.service}"
MIN_REMAINING=3
DRY_RUN=0
WORK=""

# The staging directory is global so the EXIT trap can still see it (a `local`
# of main() is gone by the time the shell exits — that bit us once).
cleanup() {
  case "$WORK" in
    "${TMPDIR:-/tmp}"/bipeur-backup-*) rm -rf "$WORK" ;;
    *) : ;;
  esac
}
trap cleanup EXIT INT TERM

log() { printf '[backup %s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die() { printf '[backup] ERROR: %s\n' "$*" >&2; exit 1; }

parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --db) DB="$2"; shift 2 ;;
      --dest) DEST="$2"; shift 2 ;;
      --keep) KEEP="$2"; shift 2 ;;
      --replica) REPLICA="$2"; shift 2 ;;
      --node) NODE="$2"; shift 2 ;;
      --repo) REPO="$2"; shift 2 ;;
      --dry-run) DRY_RUN=1; shift ;;
      -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
      *) die "unknown argument: $1" ;;
    esac
  done
  [ -f "$DB" ] || die "source database not found: $DB"
  [ "$KEEP" -ge 1 ] 2>/dev/null || die "--keep must be a positive integer"
}

require_free_space() {
  local free_mb
  free_mb=$(df -Pm "$DEST" | awk 'NR==2 {print $4}')
  log "free space on $(df -P "$DEST" | awk 'NR==2 {print $1}'): ${free_mb} MB"
  [ "$free_mb" -ge "$MIN_FREE_MB" ] || die "only ${free_mb} MB free, need ${MIN_FREE_MB} MB — refusing to write"
}

take_snapshot() { # $1 = staging dir
  local script="$REPO/tools/ops/sqlite-snapshot.mjs"
  [ -f "$script" ] || script="$(cd "$(dirname "$0")" && pwd)/sqlite-snapshot.mjs"
  [ -f "$script" ] || die "sqlite-snapshot.mjs not found (looked in $REPO/tools/ops)"
  log "snapshotting $DB (service $SERVICE: $(systemctl --user is-active "$SERVICE" 2>/dev/null || echo unknown))"
  "$NODE" --disable-warning=ExperimentalWarning "$script" --db "$DB" --out "$1/bipeur.sqlite" \
    > "$1/snapshot-manifest.json" || die "snapshot failed or did not pass integrity_check"
  grep -q '"opens_and_is_consistent": true' "$1/snapshot-manifest.json" \
    || die "snapshot is not consistent, refusing to archive it"
  log "snapshot ok: $(stat -c%s "$1/bipeur.sqlite") bytes, method $(python3 -c \
    'import json,sys;print(json.load(open(sys.argv[1]))["method"])' "$1/snapshot-manifest.json")"
}

write_manifest() { # $1 = staging dir, $2 = stamp
  local commit branch
  commit=$(git -C "$REPO" rev-parse HEAD 2>/dev/null || echo unknown)
  branch=$(git -C "$REPO" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)
  [ -f "$REPO/data/watchdog.log" ] && cp "$REPO/data/watchdog.log" "$1/watchdog.log"
  MANIFEST_STAMP="$2" MANIFEST_HOST="$(hostname)" MANIFEST_COMMIT="$commit" \
  MANIFEST_BRANCH="$branch" MANIFEST_SERVICE_STATE="$(systemctl --user is-active "$SERVICE" 2>/dev/null || echo unknown)" \
  python3 - "$1" <<'PY'
import json, os, sys
staging = sys.argv[1]
data = json.load(open(os.path.join(staging, "snapshot-manifest.json")))
for key, env in [("host", "MANIFEST_HOST"), ("taken_at_stamp", "MANIFEST_STAMP"),
                 ("repo_commit", "MANIFEST_COMMIT"), ("repo_branch", "MANIFEST_BRANCH"),
                 ("service_state", "MANIFEST_SERVICE_STATE")]:
    data[key] = os.environ.get(env, "")
data["archive_members"] = sorted(os.listdir(staging))
json.dump(data, open(os.path.join(staging, "MANIFEST.json"), "w"), indent=2, sort_keys=True)
os.remove(os.path.join(staging, "snapshot-manifest.json"))
print("[backup] manifest written: pages=%s events=%s commit=%s"
      % (data.get("counts", {}).get("pages"), data.get("counts", {}).get("events"),
         data["repo_commit"][:8]))
PY
}

pack() { # $1 = staging dir, $2 = archive path
  tar -czf "$2" -C "$1" .
  ( cd "$(dirname "$2")" && sha256sum "$(basename "$2")" > "$(basename "$2").sha256" )
  log "archive $(basename "$2") ($(stat -c%s "$2") bytes)"
}

verify_archive() { # $1 = archive path
  local listing
  listing=$(tar -tzf "$1")
  for member in ./bipeur.sqlite ./MANIFEST.json; do
    printf '%s\n' "$listing" | grep -qx "$member" || die "$member missing from the archive"
  done
  ( cd "$(dirname "$1")" && sha256sum -c "$(basename "$1").sha256" >/dev/null ) \
    || die "sha256 of the archive does not match"
  log "archive verified: members present, sha256 matches"
}

purge() { # $1 = directory, $2 = keep, $3 = pattern  (local or replica)
  local dir="$1" keep="$2" pattern="$3" count
  mapfile -t found < <(ls -1t "$dir"/$pattern 2>/dev/null || true)
  count=${#found[@]}
  if [ "$count" -le "$keep" ]; then log "retention: $count archive(s) in $dir, keeping all (limit $keep)"; return 0; fi
  local victims=("${found[@]:keep}")
  local remaining=$((count - ${#victims[@]}))
  if [ "$remaining" -lt "$MIN_REMAINING" ]; then
    log "retention: would leave $remaining < $MIN_REMAINING, keeping the $MIN_REMAINING newest instead"
    victims=("${found[@]:MIN_REMAINING}")
  fi
  local victim
  for victim in "${victims[@]}"; do
    if [ "$DRY_RUN" = 1 ]; then log "retention (dry-run): would remove $(basename "$victim")"
    else rm -f "$victim" "${victim}.sha256" && log "retention: removed $(basename "$victim")"; fi
  done
}

replica_push() { # $1 = archive path
  local target="${REPLICA%%:*}" dir="${REPLICA#*:}" name
  name=$(basename "$1")
  log "replica: pushing $name to $target:$dir"
  if [ "$DRY_RUN" = 1 ]; then log "replica (dry-run): skipped"; return 0; fi
  ssh -o BatchMode=yes "$target" "mkdir -p '$dir'" || die "replica: cannot create $target:$dir"
  ssh -o BatchMode=yes "$target" "cat > '$dir/$name'" < "$1" || die "replica: transfer failed"
  ssh -o BatchMode=yes "$target" "cat > '$dir/$name.sha256'" < "$1.sha256"
  local remote_sum local_sum
  remote_sum=$(ssh -o BatchMode=yes "$target" "sha256sum '$dir/$name' | cut -d' ' -f1")
  local_sum=$(cut -d' ' -f1 < "$1.sha256")
  [ "$remote_sum" = "$local_sum" ] || die "replica: sha256 mismatch ($remote_sum != $local_sum)"
  log "replica: sha256 verified on $target"
  ssh -o BatchMode=yes "$target" "ls -1t '$dir'"/bipeur-*.tar.gz 2>/dev/null | tail -n +$((KEEP + 1)) | \
    while read -r old; do
      [ -n "$old" ] && ssh -o BatchMode=yes "$target" "rm -f '$old' '$old.sha256'" && \
        log "replica retention: removed $(basename "$old")"
    done
}

main() {
  parse_args "$@"
  local stamp archive
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  mkdir -p "$DEST"
  require_free_space
  WORK=$(mktemp -d "${TMPDIR:-/tmp}/bipeur-backup-$stamp-XXXXXX")
  take_snapshot "$WORK"
  write_manifest "$WORK" "$stamp"
  archive="$DEST/bipeur-$stamp.tar.gz"
  if [ "$DRY_RUN" = 1 ]; then
    log "dry-run: would write $archive"; return 0
  fi
  pack "$WORK" "$archive"
  verify_archive "$archive"
  purge "$DEST" "$KEEP" "bipeur-*.tar.gz"
  [ -n "$REPLICA" ] && replica_push "$archive"
  log "DONE $archive"
  printf '%s\n' "$archive"
}

main "$@"
