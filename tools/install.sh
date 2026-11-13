#!/usr/bin/env bash
#
# install.sh — adopt Beeper in one command (idempotent, no root).
#
#   tools/install.sh             install/update: clone, build, wrappers, PATH
#   tools/install.sh --check     validate state only, change nothing (--dry-run too)
#
# Touches only:  ~/.local/share/bipeur (clone + built core/cli/mcp-server),
#                ~/bin/{bip,bipeur-mcp} (shims),
#                ~/.profile + ~/.bashrc (one guarded PATH line each).
#
# Requires node >= 24, pnpm (else corepack/npm), git — the fix is printed when
# one is missing. Safe to re-run: existing clone is `git pull`ed, writable
# artifacts are written only when absent. No curl|sh, no sudo, nothing deleted.
set -euo pipefail

REPO_URL="https://github.com/Tradoooo/bipeur"
ROOT="${BIPEUR_HOME:-$HOME/.local/share/bipeur}"
BIN_DIR="$HOME/bin"
REQUIRED_NODE=24
CHECK=0
FAILS=0

log()  { printf '  %s\n' "$*"; }
step() { printf '\n== %s\n' "$*"; }
ok()   { printf '   ok   %s\n' "$*"; }
bad()  { printf '   FAIL %s\n' "$*"; FAILS=$((FAILS + 1)); }
die()  { printf 'install.sh: %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

node_major() { node --version 2>/dev/null | sed 's/^v//' | cut -d. -f1; }

NODE_HINT="node >= $REQUIRED_NODE — https://nodejs.org/en/download, or: nvm install $REQUIRED_NODE"
PNPM_HINT="pnpm — fix: corepack enable, or: npm i -g pnpm"
GIT_HINT="git — install it, then re-run"

usage() {
  cat <<EOF
Usage: tools/install.sh [--check|--dry-run|--help]
Install or update Beeper: clone, build core/cli/mcp-server, bip + bipeur-mcp
wrappers in ~/bin, ~/bin on PATH. --check reports without changing anything.
EOF
}

parse_args() {
  case "${1:-}" in
    "")                ;;
    --check|--dry-run) CHECK=1 ;;
    -h|--help)         usage; exit 0 ;;
    *) die "unknown argument: $1 (try --help)" ;;
  esac
}

# Report one ok/FAIL line per prerequisite; never exits (caller decides).
verify_tools() {
  step "prerequisites"
  if have node && [ "$(node_major)" -ge "$REQUIRED_NODE" ] 2>/dev/null; then
    ok "node $(node --version)"
  else
    bad "$NODE_HINT"
  fi
  if have pnpm; then ok "pnpm $(pnpm --version 2>/dev/null)"; else bad "$PNPM_HINT"; fi
  if have git;  then ok "git $(git --version)"; else bad "$GIT_HINT"; fi
}

# Obtain pnpm when absent: corepack first, npm fallback.
ensure_pnpm() {
  if have pnpm; then return 0; fi
  log "pnpm not found — corepack enable, fallback npm i -g pnpm"
  have corepack && corepack enable
  ! have pnpm && have npm && npm install -g pnpm
  have pnpm
}

# Write (or repair) a shim that execs node on a built bin.js.
write_wrapper() {
  local name="$1" target="$2" file="$BIN_DIR/$name" line
  line='exec node "'"$target"'" "$@"'
  mkdir -p "$BIN_DIR"
  if [ -f "$file" ] && [ -x "$file" ] && grep -qF "$line" "$file"; then
    ok "$name up to date"
  else
    printf '#!/usr/bin/env sh\n%s\n' "$line" > "$file"
    chmod +x "$file"
    ok "wrote $file"
  fi
}

# Append one guarded "~/bin on PATH" line, only when it is absent.
add_path_line() {
  local file="$1"
  if [ -f "$file" ] && grep -qF 'export PATH="$HOME/bin:$PATH"' "$file"; then
    ok "$file already puts ~/bin on PATH"
  else
    printf '\nexport PATH="$HOME/bin:$PATH"  # bipeur installer\n' >> "$file"
    ok "added ~/bin to PATH in $file"
  fi
}

check_state() {
  verify_tools
  step "clone and build"
  [ -d "$ROOT/.git" ] && ok "clone present" || bad "clone missing at $ROOT"
  [ -d "$ROOT/packages/core/dist" ] && ok "@bipeur/core built" || bad "@bipeur/core not built"
  for p in cli mcp-server; do
    if [ -f "$ROOT/packages/$p/dist/bin.js" ]; then ok "@bipeur/$p built"; else bad "@bipeur/$p not built"; fi
  done
  step "wrappers"
  for w in bip bipeur-mcp; do
    if [ -x "$BIN_DIR/$w" ]; then ok "$BIN_DIR/$w executable"; else bad "$BIN_DIR/$w missing"; fi
  done
  step "PATH"
  for f in "$HOME/.profile" "$HOME/.bashrc"; do
    if [ -f "$f" ] && grep -qF 'export PATH="$HOME/bin:$PATH"' "$f"; then
      ok "$f puts ~/bin on PATH"
    else
      bad "$f does not put ~/bin on PATH"
    fi
  done
}

install() {
  verify_tools
  [ "$FAILS" -eq 0 ] || die "prerequisites missing — see the FAIL lines above."
  ensure_pnpm || die "could not put pnpm on PATH."

  step "clone or update"
  if [ -d "$ROOT/.git" ]; then
    git -C "$ROOT" pull --ff-only
    ok "updated $ROOT"
  else
    mkdir -p "$(dirname "$ROOT")"
    git clone "$REPO_URL" "$ROOT"
    ok "cloned $REPO_URL"
  fi

  step "install + build"
  ( cd "$ROOT" && pnpm install --frozen-lockfile ) || die "pnpm install failed"
  ( cd "$ROOT" && pnpm --filter @bipeur/core --filter @bipeur/cli --filter @bipeur/mcp-server build ) \
    || die "build of @bipeur/core|cli|mcp-server failed"
  ok "built @bipeur/core, @bipeur/cli, @bipeur/mcp-server"

  step "wrappers in $BIN_DIR"
  write_wrapper bip "$ROOT/packages/cli/dist/bin.js"
  write_wrapper bipeur-mcp "$ROOT/packages/mcp-server/dist/bin.js"

  step "PATH"
  add_path_line "$HOME/.profile"
  add_path_line "$HOME/.bashrc"
}

next_steps() {
  cat <<EOF

== done — next steps

bip and bipeur-mcp are on your PATH (new shells; this shell:
  export PATH="\$HOME/bin:\$PATH" ).

Point them at a Central (self-hosted, or the public demo):
  export BIPEUR_URL=<the Central base URL, e.g. http://127.0.0.1:8787>
  export BIPEUR_TOKEN=bip_…          # the station token

Run your own Central (optional — prints the token at first boot):
  cd $ROOT
  pnpm --filter @bipeur/central build          # the Central is not built above
  BIPEUR_DEMO=1 pnpm --filter @bipeur/central start

Open the pager (the URL the Central prints) and try:
  bip ask "Deploy to production?" --yes-no --ttl 10m     # 0=yes 1=no 3=expired
  bipeur-mcp                                            # MCP: page_human, page_wait, …
EOF
}

main() {
  parse_args "$@"
  if [ "$CHECK" -eq 1 ]; then
    check_state
    if [ "$FAILS" -eq 0 ]; then step "all good — Beeper is installed"; else step "$FAILS item(s) missing"; fi
    exit "$FAILS"
  fi
  install
  next_steps
}

main "$@"