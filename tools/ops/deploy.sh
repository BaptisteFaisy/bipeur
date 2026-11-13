#!/usr/bin/env bash
# Update the running instance in ONE command, and roll back by itself if the new
# build does not come up.
#
#   tools/ops/deploy.sh                      # deploy origin/main
#   tools/ops/deploy.sh --ref v0.2.0         # deploy anything git can resolve
#   tools/ops/deploy.sh --no-backup          # skip the pre-deploy snapshot
#
# What it does, in order:
#   1. preflight — the clone must have no local modification to a tracked file
#      (untracked files such as data/ are fine); the service unit must exist;
#   2. snapshot the database (tools/ops/backup.sh) so a schema migration gone
#      wrong is recoverable — this is the "no destructive step without a backup"
#      rule applied to `git reset --hard`;
#   3. fetch, resolve the requested ref to a commit, check it out, install with
#      the lockfile frozen, build;
#   4. restart the service and wait for /healthz to answer {"ok":true} and for /
#      to serve the pager page — measuring the downtime while it does;
#   5. on ANY failure from step 3 on: go back to the previous commit, rebuild,
#      restart, verify again, and exit non-zero with both verdicts in the log.
#
# Already at the requested commit? Nothing is rebuilt and nothing is restarted:
# the script only verifies health and says so. Deploying is idempotent.
set -uo pipefail

REPO="${BIPEUR_REPO:-$HOME/bipeur-demo}"
REF="${BIPEUR_DEPLOY_REF:-origin/main}"
SERVICE="${BIPEUR_SERVICE:-bipeur-central.service}"
HEALTH_URL="${BIPEUR_HEALTH_URL:-http://127.0.0.1:8813/healthz}"
ROOT_URL="${BIPEUR_ROOT_URL:-http://127.0.0.1:8813/}"
WAIT_S="${BIPEUR_DEPLOY_WAIT:-150}"
FETCH_TIMEOUT="${BIPEUR_DEPLOY_FETCH_TIMEOUT:-120}"
INSTALL_TIMEOUT="${BIPEUR_DEPLOY_INSTALL_TIMEOUT:-300}"
BUILD_TIMEOUT="${BIPEUR_DEPLOY_BUILD_TIMEOUT:-600}"
NO_BACKUP=0
HERE="$(cd "$(dirname "$0")" && pwd)"
BEFORE=""
TARGET=""

log() { printf '[deploy %s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die() { printf '[deploy] FAIL: %s\n' "$*" >&2; exit 1; }

parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --repo) REPO="$2"; shift 2 ;;
      --ref) REF="$2"; shift 2 ;;
      --service) SERVICE="$2"; shift 2 ;;
      --health-url) HEALTH_URL="$2"; shift 2 ;;
      --root-url) ROOT_URL="$2"; shift 2 ;;
      --wait) WAIT_S="$2"; shift 2 ;;
      --no-backup) NO_BACKUP=1; shift ;;
      -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
      *) die "unknown argument: $1" ;;
    esac
  done
}

preflight() {
  cd "$REPO" || die "no such clone: $REPO"
  git rev-parse --git-dir >/dev/null 2>&1 || die "$REPO is not a git clone"
  local dirty
  dirty=$(git status --porcelain --untracked-files=no)
  [ -z "$dirty" ] || die "the clone has local modifications, refusing to reset --hard:
$dirty"
  systemctl --user cat "$SERVICE" >/dev/null 2>&1 || die "systemd user unit $SERVICE not found"
  command -v pnpm >/dev/null || die "pnpm not on PATH"
  BEFORE=$(git rev-parse HEAD)
  log "clone $REPO on $(git rev-parse --abbrev-ref HEAD), running commit ${BEFORE:0:8}"
}

resolve_target() {
  timeout "$FETCH_TIMEOUT" git fetch --prune origin || die "git fetch failed"
  TARGET=$(git rev-parse "$REF" 2>/dev/null) || die "cannot resolve ref: $REF"
  log "target ${REF} = ${TARGET:0:8}"
  if [ "$TARGET" = "$BEFORE" ]; then
    log "already at the target commit — no rebuild, no restart"
    verify "unchanged instance" || die "the instance is not healthy although nothing changed"
    log "DONE still on ${TARGET:0:8}"
    exit 0
  fi
}

snapshot_before_deploy() {
  if [ "$NO_BACKUP" = 1 ]; then log "skipping the pre-deploy snapshot (--no-backup)"; return 0; fi
  [ -x "$HERE/backup.sh" ] || { log "no backup.sh next to deploy.sh, skipping the snapshot"; return 0; }
  log "snapshotting the database before touching the code"
  "$HERE/backup.sh" --repo "$REPO" >/dev/null || die "the pre-deploy backup failed — not deploying"
}

install_and_build() { # $1 = commit to check out
  cd "$REPO"
  git reset --hard "$1" >/dev/null || return 1
  log "checked out ${1:0:8}"
  timeout "$INSTALL_TIMEOUT" pnpm install --frozen-lockfile >/tmp/bipeur-deploy-install.log 2>&1 || {
    tail -20 /tmp/bipeur-deploy-install.log >&2; return 1; }
  log "dependencies installed from the lockfile"
  timeout "$BUILD_TIMEOUT" pnpm build >/tmp/bipeur-deploy-build.log 2>&1 || {
    tail -30 /tmp/bipeur-deploy-build.log >&2; return 1; }
  log "build ok"
}

restart_and_verify() {
  local started
  started=$(date +%s)
  systemctl --user restart "$SERVICE" || return 1
  log "restarted $SERVICE, waiting for $HEALTH_URL (limit ${WAIT_S}s)"
  verify "restarted instance" || return 1
  log "downtime: $(( $(date +%s) - started )) s from restart to healthy"
}

verify() { # $1 = label; checks /healthz and / on the live bind
  local label="$1" body code
  if ! timeout "$WAIT_S" bash -c "until curl -fsS -m 5 '$HEALTH_URL' >/dev/null 2>&1; do sleep 2; done"; then
    log "$label: /healthz never answered within ${WAIT_S}s"
    journalctl --user -u "$SERVICE" -n 20 --no-pager 2>/dev/null | tail -20 >&2
    return 1
  fi
  body=$(curl -sS -m 10 "$HEALTH_URL") || { log "$label: cannot read /healthz"; return 1; }
  printf '%s' "$body" | grep -q '"ok":true' || { log "$label: /healthz said $body"; return 1; }
  code=$(curl -sS -m 10 -o /tmp/bipeur-deploy-root.html -w '%{http_code}' "$ROOT_URL")
  [ "$code" = 200 ] || { log "$label: GET / returned $code"; return 1; }
  grep -q '<title>Beeper</title>' /tmp/bipeur-deploy-root.html \
    || { log "$label: GET / is not the pager page"; return 1; }
  log "$label: healthy — /healthz $body, / 200 with the pager page"
}

rollback() {
  log "ROLLBACK to ${BEFORE:0:8}"
  if install_and_build "$BEFORE" && restart_and_verify; then
    log "rollback succeeded, the previous commit ${BEFORE:0:8} is serving again"
  else
    log "rollback FAILED — the instance needs a human, see docs/OPERATIONS.md"
  fi
}

main() {
  parse_args "$@"
  preflight
  resolve_target
  snapshot_before_deploy
  if install_and_build "$TARGET" && restart_and_verify; then
    log "DONE ${TARGET:0:8} is live and healthy"
    exit 0
  fi
  rollback
  exit 1
}

main "$@"
