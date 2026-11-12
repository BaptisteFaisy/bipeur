#!/usr/bin/env bash
#
# snpp-funnel.sh — expose the SNPP gateway (RFC 1861, TCP 4440) to the public
# internet through a Tailscale Funnel raw-TCP forwarder. Idempotent: it checks
# `tailscale funnel status` before changing anything.
#
#   tools/ops/snpp-funnel.sh            # apply the funnel
#   tools/ops/snpp-funnel.sh --off      # remove the SNPP funnel only
#
# Tailscale Funnel only allows the public TCP ports 443, 8443 and 10000, so the
# gateway keeps listening on the loopback 4440 and the funnel publishes it on a
# different public port — 10000 here (override with BIPEUR_SNPP_FUNNEL_PORT).
#
# THIS SCRIPT ONLY MANAGES THE FUNNEL. It neither starts the gateway nor checks
# the plaintext guard. SNPP is cleartext: before you run it, the gateway MUST
# require LOGIn — set BIPEUR_SNPP_LOGIN=id:password in its environment. See
# docs/DEPLOYMENT.md § 4c. It is intentionally *not* run here: read it, satisfy
# the guard, then run it yourself.
set -euo pipefail

LOCAL_PORT="${BIPEUR_SNPP_PORT:-4440}"
LOCAL_HOST="${BIPEUR_SNPP_FUNNEL_HOST:-127.0.0.1}"
PUB_PORT="${BIPEUR_SNPP_FUNNEL_PORT:-10000}"
MODE="on"

die() { printf 'snpp-funnel.sh: %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<EOF
Usage: tools/ops/snpp-funnel.sh [--off|--help]

Expose the SNPP gateway (loopback :$LOCAL_PORT) publicly as raw TCP on the
Funnel port :$PUB_PORT. Funnel only accepts 443, 8443 or 10000 as the public
TCP port. Requires BIPEUR_SNPP_LOGIN set on the gateway (plaintext protocol).

  (no flag)   apply the funnel (idempotent)
  --off       remove the SNPP funnel only
EOF
}

parse_args() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --off)  MODE="off" ;;
      -h|--help) usage; exit 0 ;;
      *) die "unknown argument: $1 (try --help)" ;;
    esac
    shift
  done
}

# tailscale must exist; the public port must be one Funnel accepts.
check_env() {
  command -v tailscale >/dev/null 2>&1 || die "tailscale is not installed"
  case "$PUB_PORT" in
    443|8443|10000) ;;
    *) die "BIPEUR_SNPP_FUNNEL_PORT=$PUB_PORT is not a Funnel TCP port (443, 8443 or 10000)" ;;
  esac
}

# True when the SNPP funnel is already registered on the public port.
funnel_up() {
  tailscale funnel status 2>/dev/null | grep -q ":$PUB_PORT"
}

apply() {
  if funnel_up; then
    printf 'already funneled: '
    tailscale funnel status 2>/dev/null | grep ":$PUB_PORT"
    return 0
  fi
  printf 'enabling raw TCP funnel :%s -> %s:%s\n' "$PUB_PORT" "$LOCAL_HOST" "$LOCAL_PORT"
  tailscale funnel "--tcp=$PUB_PORT" "tcp://$LOCAL_HOST:$LOCAL_PORT"
  tailscale funnel status 2>/dev/null | grep ":$PUB_PORT" || true
  printf '\npublic endpoint: tcp://<this-node>.ts.net:%s  (see "tailscale funnel status")\n' "$PUB_PORT"
}

remove() {
  if funnel_up; then
    printf 'removing raw TCP funnel :%s\n' "$PUB_PORT"
    tailscale funnel "--tcp=$PUB_PORT" off
    printf 'done — other funnels are left untouched.\n'
  else
    printf 'not funneled on :%s — nothing to remove.\n' "$PUB_PORT"
  fi
}

main() {
  parse_args "$@"
  check_env
  if [ "$MODE" = "off" ]; then
    remove
  else
    apply
  fi
}

main "$@"