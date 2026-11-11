#!/usr/bin/env bash
# Local watchdog: probe the Central, restart it only when it is really gone.
#
# Installed as a systemd user timer on the host (units in docs/OPERATIONS.md).
# This is the *local* half of the supervision; the external half is
# .github/workflows/uptime.yml, which is what notices when the host itself dies.
#
# Tuning, and why (measured on the r630, a host shared with five other agents,
# load average up to 138):
#   * PROBE_TIMEOUT=30 s — the previous 15 s produced a false failure at
#     2026-11-11T17:16:10 while the instance was perfectly healthy, and the
#     Central itself needed 14 s to boot under load.
#   * PROBE_TRIES=3 — three attempts 3 s apart inside one run, so a single slow
#     answer never counts as a failure.
#   * FAIL_THRESHOLD=5 — five consecutive failed runs (5 minutes at the timer's
#     60 s cadence) before a restart. Three was too eager: a host busy for two
#     minutes would have been "repaired" into a restart loop, and each restart
#     costs ~14 s of real unavailability plus more load.
#   * COOLDOWN_S=600 — after a restart, no new restart for ten minutes, so a
#     slow boot can never be mistaken for a dead process.
#
# Every decision is logged: a watchdog that cannot show its log cannot be
# trusted.
set -u

HOST="${BIPEUR_WATCHDOG_HOST:-127.0.0.1}"
PORT="${BIPEUR_WATCHDOG_PORT:-8813}"
DATA_DIR="${BIPEUR_WATCHDOG_DATA:-$HOME/bipeur-demo/data}"
STATE="${BIPEUR_WATCHDOG_STATE:-$DATA_DIR/.watchdog-fails}"
LOG="${BIPEUR_WATCHDOG_LOG:-$DATA_DIR/watchdog.log}"
LAST_RESTART="${BIPEUR_WATCHDOG_LAST_RESTART:-$DATA_DIR/.watchdog-last-restart}"
PROBE_TIMEOUT="${BIPEUR_WATCHDOG_TIMEOUT:-30}"
PROBE_TRIES="${BIPEUR_WATCHDOG_TRIES:-3}"
PROBE_GAP="${BIPEUR_WATCHDOG_GAP:-3}"
FAIL_THRESHOLD="${BIPEUR_WATCHDOG_THRESHOLD:-5}"
COOLDOWN_S="${BIPEUR_WATCHDOG_COOLDOWN:-600}"
SERVICE="${BIPEUR_WATCHDOG_SERVICE:-bipeur-central.service}"
RESTART_CMD="${BIPEUR_WATCHDOG_RESTART_CMD:-systemctl --user restart $SERVICE}"

log() { printf '%s %s\n' "$(date -Is)" "$*" >> "$LOG"; }
read_number() { cat "$1" 2>/dev/null || echo 0; }

probe_once() {
  curl -sS --max-time "$PROBE_TIMEOUT" -o /dev/null "http://$HOST:$PORT/healthz" 2>/dev/null
}

probe_with_retries() { # returns 0 when at least one attempt answered
  local attempt=1
  while [ "$attempt" -le "$PROBE_TRIES" ]; do
    if probe_once; then
      [ "$attempt" -gt 1 ] && log "healthz answered on attempt $attempt/$PROBE_TRIES (slow, not dead)"
      return 0
    fi
    attempt=$((attempt + 1))
    [ "$attempt" -le "$PROBE_TRIES" ] && sleep "$PROBE_GAP"
  done
  return 1
}

in_cooldown() {
  local last now
  last=$(read_number "$LAST_RESTART")
  [ "$last" = 0 ] && return 1
  now=$(date +%s)
  [ $((now - last)) -lt "$COOLDOWN_S" ]
}

restart_central() {
  if in_cooldown; then
    log "still failing but inside the ${COOLDOWN_S}s cooldown after the last restart — not restarting again"
    return 0
  fi
  log "restarting $SERVICE after $FAIL_THRESHOLD consecutive failed runs"
  # shellcheck disable=SC2086
  if $RESTART_CMD; then
    date +%s > "$LAST_RESTART"
    log "restart command succeeded"
  else
    log "restart command FAILED (exit $?)"
  fi
  echo 0 > "$STATE"
}

main() {
  mkdir -p "$(dirname "$STATE")"
  local fails
  fails=$(read_number "$STATE")
  if probe_with_retries; then
    [ "$fails" != 0 ] && log "ok again after $fails failed run(s)"
    echo 0 > "$STATE"
    exit 0
  fi
  fails=$((fails + 1))
  echo "$fails" > "$STATE"
  log "healthz failed ($fails/$FAIL_THRESHOLD) after $PROBE_TRIES attempt(s) of ${PROBE_TIMEOUT}s"
  [ "$fails" -ge "$FAIL_THRESHOLD" ] && restart_central
  exit 0
}

main "$@"
