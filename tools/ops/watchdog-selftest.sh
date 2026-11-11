#!/usr/bin/env bash
# Self-test of tools/ops/watchdog.sh: prove when it restarts, and when it does
# not. Run it anywhere (no Central, no systemd, no network needed):
#
#   tools/ops/watchdog-selftest.sh
#
# Scenario A — a slow but alive instance (answers after 5 s, probe times out
#   after 2 s) survives three consecutive failed runs with the shipped tuning
#   (threshold 5). This is the case that mattered on the r630: a host shared
#   with five other agents, load average measured up to 138, a Central that
#   needed 14 s to boot.
# Scenario B — the same instance WOULD have been restarted under the previous
#   tuning (threshold 3), which is the restart-loop risk this test exists to
#   show was real, not theoretical.
# Scenario C — a dead port is restarted once the threshold is reached, and a
#   second restart inside the cooldown is suppressed.
# Scenario D — a healthy instance keeps the failure counter at zero.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/watchdog-selftest-XXXXXX")"
PIDS=()
FAILED=0

cleanup() {
  local pid
  for pid in "${PIDS[@]:-}"; do kill "$pid" 2>/dev/null || true; done
  case "$WORK" in "${TMPDIR:-/tmp}"/watchdog-selftest-*) rm -rf "$WORK" ;; esac
}
trap cleanup EXIT INT TERM

free_port() {
  python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()'
}

start_slow_server() { # $1 = port, $2 = delay in seconds
  python3 - "$1" "$2" >/dev/null 2>&1 <<'PY' &
import sys, time
from http.server import BaseHTTPRequestHandler, HTTPServer
delay = float(sys.argv[2])
class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        time.sleep(delay)
        body = b'{"ok":true,"version":"0.1.0"}'
        self.send_response(200)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def log_message(self, *args):
        pass
HTTPServer(("127.0.0.1", int(sys.argv[1])), Handler).serve_forever()
PY
  PIDS+=("$!")
  sleep 1
}

run_watchdog() { # $1 = port, $2 = threshold, $3 = restart log, $4 = runs
  local port="$1" threshold="$2" restarts="$3" runs="$4" run
  # The restart command must be a single word: watchdog.sh runs it unquoted, so
  # an inline `bash -c '…'` would be split on spaces. A tiny script avoids that.
  printf '#!/bin/sh\necho restart >> %s\n' "$restarts" > "$WORK/restart-cmd.sh"
  chmod +x "$WORK/restart-cmd.sh"
  for ((run = 1; run <= runs; run++)); do
    BIPEUR_WATCHDOG_HOST=127.0.0.1 BIPEUR_WATCHDOG_PORT="$port" \
    BIPEUR_WATCHDOG_DATA="$WORK" BIPEUR_WATCHDOG_STATE="$WORK/.fails" \
    BIPEUR_WATCHDOG_LOG="$WORK/watchdog.log" BIPEUR_WATCHDOG_LAST_RESTART="$WORK/.last" \
    BIPEUR_WATCHDOG_TIMEOUT=2 BIPEUR_WATCHDOG_TRIES=1 BIPEUR_WATCHDOG_GAP=0 \
    BIPEUR_WATCHDOG_THRESHOLD="$threshold" BIPEUR_WATCHDOG_COOLDOWN=600 \
    BIPEUR_WATCHDOG_RESTART_CMD="$WORK/restart-cmd.sh" \
      bash "$HERE/watchdog.sh"
  done
}

restart_count() { [ -f "$1" ] && wc -l < "$1" | tr -d ' ' || echo 0; }
fails_now() { cat "$WORK/.fails" 2>/dev/null || echo 0; }

assert() { # $1 = scenario, $2 = expected, $3 = actual
  if [ "$2" = "$3" ]; then
    echo "  PASS $1 (expected $2)"
  else
    echo "  FAIL $1: expected $2, got $3"; FAILED=$((FAILED + 1))
  fi
}

scenario_a() {
  echo "A) slow but alive instance, shipped threshold 5, three failed runs"
  local port; port=$(free_port)
  start_slow_server "$port" 5
  rm -f "$WORK/.fails" "$WORK/restarts-a" "$WORK/watchdog.log"
  run_watchdog "$port" 5 "$WORK/restarts-a" 3
  assert "no restart" 0 "$(restart_count "$WORK/restarts-a")"
  assert "failure counter" 3 "$(fails_now)"
  kill "${PIDS[-1]}" 2>/dev/null || true
}

scenario_b() {
  echo "B) same instance under the OLD threshold 3 — the restart-loop risk"
  local port; port=$(free_port)
  start_slow_server "$port" 5
  rm -f "$WORK/.fails" "$WORK/restarts-b" "$WORK/watchdog.log" "$WORK/.last"
  run_watchdog "$port" 3 "$WORK/restarts-b" 3
  assert "restarted" 1 "$(restart_count "$WORK/restarts-b")"
  kill "${PIDS[-1]}" 2>/dev/null || true
}

scenario_c() {
  echo "C) dead port, threshold 2, cooldown suppresses the second restart"
  local port; port=$(free_port)
  rm -f "$WORK/.fails" "$WORK/restarts-c" "$WORK/watchdog.log" "$WORK/.last"
  run_watchdog "$port" 2 "$WORK/restarts-c" 4
  assert "exactly one restart" 1 "$(restart_count "$WORK/restarts-c")"
  grep -q "cooldown" "$WORK/watchdog.log" && echo "  PASS cooldown logged" \
    || { echo "  FAIL cooldown not logged"; FAILED=$((FAILED + 1)); }
}

scenario_d() {
  echo "D) healthy instance keeps the counter at zero"
  local port; port=$(free_port)
  start_slow_server "$port" 0
  rm -f "$WORK/.fails" "$WORK/restarts-d" "$WORK/watchdog.log"
  echo 2 > "$WORK/.fails"
  run_watchdog "$port" 5 "$WORK/restarts-d" 1
  assert "no restart" 0 "$(restart_count "$WORK/restarts-d")"
  assert "counter reset" 0 "$(fails_now)"
  grep -q "ok again after 2 failed run(s)" "$WORK/watchdog.log" \
    && echo "  PASS recovery logged" || { echo "  FAIL recovery not logged"; FAILED=$((FAILED + 1)); }
  kill "${PIDS[-1]}" 2>/dev/null || true
}

scenario_a; scenario_b; scenario_c; scenario_d
echo
if [ "$FAILED" = 0 ]; then
  echo "watchdog self-test: PASS (4 scenarios) — log sample:"
  sed 's/^/  | /' "$WORK/watchdog.log" | head -12
  exit 0
fi
echo "watchdog self-test: FAIL ($FAILED assertion(s))"
exit 1
