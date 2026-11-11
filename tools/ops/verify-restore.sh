#!/usr/bin/env bash
# Prove a backup is restorable: restore it, boot a real Central on it, read the
# data back.
#
# "A backup that was never restored is not a backup." This script is that
# proof, runnable by hand or by a timer:
#   1. restore the archive into a fresh temporary directory (restore.sh);
#   2. read the restored database and compare it with the MANIFEST.json that
#      backup.sh wrote when the snapshot was taken — page count (the bips) and
#      the last audit event must match exactly;
#   3. start a real Central on the restored database, on a free loopback port,
#      and wait for GET /healthz to answer {"ok":true} and GET / to serve the
#      pager page;
#   4. stop the Central and delete the temporary directory.
#
# Nothing here touches the production instance: the restored database is a copy
# in a temp directory and the Central listens on 127.0.0.1 only.
#
# Usage:
#   tools/ops/verify-restore.sh --archive PATH [--repo DIR] [--node PATH]
#                               [--port N] [--wait S]
set -euo pipefail

ARCHIVE=""
REPO="${BIPEUR_REPO:-$HOME/bipeur-demo}"
NODE="${BIPEUR_NODE:-node}"
PORT=""
WAIT_S="${BIPEUR_VERIFY_WAIT:-90}"
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK=""
PID=""

log() { printf '[verify %s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die() { printf '[verify] FAIL: %s\n' "$*" >&2; exit 1; }

cleanup() {
  if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
    log "stopping the temporary Central (pid $PID)"
    kill "$PID" 2>/dev/null || true
    wait "$PID" 2>/dev/null || true
  fi
  case "$WORK" in
    /tmp/bipeur-verify-*|"${TMPDIR:-/tmp}"/bipeur-verify-*) rm -rf "$WORK" ;;
    *) [ -n "$WORK" ] && log "leaving $WORK in place (not a temp path I created)" ;;
  esac
}
trap cleanup EXIT INT TERM

parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --archive) ARCHIVE="$2"; shift 2 ;;
      --repo) REPO="$2"; shift 2 ;;
      --node) NODE="$2"; shift 2 ;;
      --port) PORT="$2"; shift 2 ;;
      --wait) WAIT_S="$2"; shift 2 ;;
      -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
      *) die "unknown argument: $1" ;;
    esac
  done
  [ -n "$ARCHIVE" ] || die "--archive is required"
  [ -f "$REPO/packages/central/dist/bin.js" ] || die "no built Central in $REPO (run pnpm build)"
}

free_port() {
  python3 - <<'PY'
import socket
s = socket.socket()
s.bind(("127.0.0.1", 0))
print(s.getsockname()[1])
s.close()
PY
}

compare_with_manifest() { # $1 = restored dir
  MANIFEST="$1/MANIFEST.json" DB="$1/bipeur.sqlite" "$NODE" \
    --disable-warning=ExperimentalWarning - <<'NODE_EOF'
const { readFileSync } = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const manifest = JSON.parse(readFileSync(process.env.MANIFEST, 'utf8'));
const db = new DatabaseSync(process.env.DB, { readOnly: true });
const count = (t) => Number(db.prepare(`SELECT count(*) AS n FROM "${t}"`).get().n);
const last = db.prepare('SELECT id, ts, type FROM events ORDER BY id DESC LIMIT 1').get();
const expected = manifest.counts || {};
const problems = [];
for (const table of ['pages', 'events']) {
  const actual = count(table);
  if (actual !== Number(expected[table])) {
    problems.push(`${table}: restored ${actual}, manifest says ${expected[table]}`);
  } else {
    console.log(`[verify] ${table}: ${actual} row(s), matches the manifest`);
  }
}
const expectedEvent = manifest.last_event || null;
const actualEvent = last ? { id: Number(last.id), type: String(last.type) } : null;
if (!expectedEvent && !actualEvent) {
  console.log('[verify] no audit event in the backup, none in the restore');
} else if (!actualEvent || String(actualEvent.id) !== String(expectedEvent.id)
    || actualEvent.type !== expectedEvent.type) {
  problems.push(`last audit event: restored ${JSON.stringify(actualEvent)}, manifest says ${JSON.stringify(expectedEvent)}`);
} else {
  console.log(`[verify] last audit event: #${actualEvent.id} ${actualEvent.type}, matches the manifest`);
}
if (problems.length) {
  console.error(`[verify] FAIL ${problems.join('; ')}`);
  process.exit(1);
}
console.log('[verify] restored database matches the manifest exactly');
NODE_EOF
}

start_central() { # $1 = restored dir, $2 = port
  log "starting a Central on 127.0.0.1:$2 over the restored database"
  ( cd "$REPO" && \
    BIPEUR_HOST=127.0.0.1 BIPEUR_PORT="$2" BIPEUR_DB="$1/bipeur.sqlite" \
    BIPEUR_RULES="$REPO/.bipeur/rules.yaml" BIPEUR_DEMO=1 \
    NODE_OPTIONS=--disable-warning=ExperimentalWarning \
    "$NODE" packages/central/dist/bin.js > "$1/central.log" 2>&1 ) &
  PID=$!
}

wait_healthy() { # $1 = port, $2 = work dir
  log "waiting up to ${WAIT_S}s for /healthz (a loaded host took 14 s to boot)"
  timeout "$WAIT_S" bash -c "until curl -fsS -m 5 \"http://127.0.0.1:$1/healthz\" >/dev/null 2>&1; do sleep 1; done" \
    || { tail -20 "$2/central.log" >&2; die "the Central never answered /healthz within ${WAIT_S}s"; }
  local body code
  body=$(curl -sS -m 10 "http://127.0.0.1:$1/healthz")
  [ "$body" = '{"ok":true,"version":"0.1.0"}' ] || log "healthz body: $body"
  printf '%s' "$body" | grep -q '"ok":true' || die "/healthz did not say ok:true ($body)"
  code=$(curl -sS -m 10 -o "$2/root.html" -w '%{http_code}' "http://127.0.0.1:$1/")
  [ "$code" = 200 ] || die "GET / returned $code"
  grep -q '<title>Beeper</title>' "$2/root.html" || die "GET / did not serve the pager page"
  log "healthy: /healthz -> $body ; / -> 200 with the pager page ($(stat -c%s "$2/root.html") bytes)"
  curl -sS -m 10 "http://127.0.0.1:$1/v1/metrics" > "$2/metrics.json" 2>/dev/null \
    && log "metrics of the restored instance: $(head -c 200 "$2/metrics.json")" || true
}

main() {
  parse_args "$@"
  WORK=$(mktemp -d "${TMPDIR:-/tmp}/bipeur-verify-XXXXXX")
  log "restoring $ARCHIVE into $WORK"
  "$HERE/restore.sh" --archive "$ARCHIVE" --target "$WORK/data" --node "$NODE"
  compare_with_manifest "$WORK/data"
  PORT="${PORT:-$(free_port)}"
  start_central "$WORK/data" "$PORT"
  wait_healthy "$PORT" "$WORK/data"
  log "PASS — the archive restores, the data is intact and a Central serves it"
}

main "$@"
