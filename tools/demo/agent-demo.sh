#!/usr/bin/env bash
# The real demo: a real agent, in a real repository, stopped by a real human
# on a real pager.
#
#   tools/demo/agent-demo.sh [--model <provider/model>] [--keep] [--no-open]
#
# What happens, in order:
#   1. a fresh world: a bare "staging" remote, and a clone of acme-api with
#      one commit — a real git repository, a real remote, a real push to make;
#   2. the gate plugin is installed in the project: opencode loads it, and
#      every tool call the agent makes passes through the rules;
#   3. a real agent (opencode) is launched with the release task;
#   4. the agent edits the version, writes the changelog, commits... and when
#      it pushes, the gate opens a page and waits for a human;
#   5. the human answers on the pager: the push goes through, or the agent is
#      told no — and it has to live with it.
#
# Environment:
#   BIPEUR_URL      the Central, default the demo instance
#   BIPEUR_TOKEN    the station token of the agent (from ~/.bipeur/stations.env)
#   BIPEUR_MODEL    the model, default a free one
#   BIPEUR_DEMO_ROOT where the world is built, default /tmp/bipeur-agent-demo
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ROOT="${BIPEUR_DEMO_ROOT:-/tmp/bipeur-agent-demo}"
MODEL="${BIPEUR_MODEL:-opencode/glm-5.3-flash-free}"
CENTRAL="${BIPEUR_URL:-https://r630-debian.tail3a8bdf.ts.net}"
PAGER_URL="${BIPEUR_PAGER_URL:-https://tradoooo.github.io/bipeur/app/}"
KEEP=0
OPEN_PAGER=1

while [ $# -gt 0 ]; do
  case "$1" in
    --model) MODEL="$2"; shift 2 ;;
    --keep) KEEP=1; shift ;;
    --no-open) OPEN_PAGER=0; shift ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

say() { printf '\n\033[1m[bipeur demo]\033[0m %s\n' "$*"; }
die() { printf '\033[31m[bipeur demo] %s\033[0m\n' "$*" >&2; exit 1; }

command -v opencode >/dev/null 2>&1 || die "opencode is not installed"
command -v git >/dev/null 2>&1 || die "git is not installed"

# The station token of the agent: the same one opencode's MCP server uses.
TOKEN="${BIPEUR_TOKEN:-}"
if [ -z "$TOKEN" ] && [ -f "$HOME/.bipeur/stations.env" ]; then
  TOKEN="$(grep '^oc=' "$HOME/.bipeur/stations.env" | cut -d= -f2-)"
fi
[ -n "$TOKEN" ] || die "no station token: set BIPEUR_TOKEN, or create ~/.bipeur/stations.env"

# The gate must be built before opencode can load it.
PLUGIN="$REPO_ROOT/packages/opencode-gate/dist/plugin.js"
if [ ! -f "$PLUGIN" ]; then
  say "building the gate plugin"
  (cd "$REPO_ROOT" && pnpm --filter @bipeur/opencode-gate build) >/dev/null 2>&1 \
    || die "the gate plugin did not build"
fi

say "building the world in $ROOT"
rm -rf "$ROOT"
mkdir -p "$ROOT"
git init --bare -q "$ROOT/staging.git"
cp -R "$REPO_ROOT/tools/demo/acme-api" "$ROOT/project"

# The rules of the Central, with two additions for the demo:
#   - a commit is cheap and reversible, a push is not;
#   - the ordinary commands of a working session (read a file, edit it, look
#     at the log) must not page: the demo is about the *irreversible* step,
#     and a pager that rings for every `sed` would be a toy, not a product.
mkdir -p "$ROOT/project/.bipeur"
cp "$REPO_ROOT/.bipeur/rules.yaml" "$ROOT/project/.bipeur/rules.yaml"
python3 - "$ROOT/project/.bipeur/rules.yaml" <<'PY'
import sys
path = sys.argv[1]
text = open(path).read()
extra = [
    'git add*', 'git commit*', 'git branch*', 'git remote*', 'git rev-parse*',
    'git config*', 'git init*', 'sed*', 'python3*', 'python*', 'node *',
    'npm --version', 'npm view*', 'mkdir*', 'cp *', 'mv *', 'echo *', 'printf *',
    'head *', 'tail *', 'sort *', 'uniq *', 'diff *', 'pwd', 'whoami', 'date',
    'touch *', 'find *', 'jq *', 'which *', 'test *', 'true', 'false',
]
marker = '      - "git status*"'
if '"git commit*"' not in text:
    lines = ''.join(f'      - "{pattern}"\n' for pattern in extra)
    text = text.replace(marker, lines + marker, 1)
    open(path, 'w').write(text)
PY

cd "$ROOT/project" || die "no project"
git init -q -b main
git config user.email demo@bipeur.local
git config user.name "Beeper Demo"
git add -A
git commit -q -m "feat: acme-api 1.1.0 — the release before the demo"
git remote add origin "$ROOT/staging.git"
git push -q origin main

# The gate: opencode v2 loads the plugins of .opencode/plugins/.
mkdir -p "$ROOT/project/.opencode/plugins"
ln -sf "$PLUGIN" "$ROOT/project/.opencode/plugins/bipeur-gate.js"

if [ "$OPEN_PAGER" = "1" ] && command -v xdg-open >/dev/null 2>&1; then
  say "opening the pager: $PAGER_URL"
  DISPLAY="${DISPLAY:-:0}" xdg-open "$PAGER_URL" >/dev/null 2>&1 || true
fi

TASK="You are the release engineer of acme-api. Prepare the release 1.2.0:
1. bump the version to 1.2.0 in package.json;
2. add the 1.2.0 entry in CHANGELOG.md;
3. commit with the message 'release: 1.2.0';
4. push to origin (the staging remote): git push origin main.
If a tool call is refused, do not work around it and do not retry it: report
what happened and stop."

say "launching the agent ($MODEL) — answer on the pager when it rings"
BIPEUR_URL="$CENTRAL" BIPEUR_TOKEN="$TOKEN" BIPEUR_RULES="$ROOT/project/.bipeur/rules.yaml" \
  opencode run --standalone -m "$MODEL" "$TASK"
STATUS=$?

say "what the staging remote holds"
git --git-dir="$ROOT/staging.git" log --oneline -3 2>/dev/null || true
git --git-dir="$ROOT/staging.git" show-ref 2>/dev/null || true

if [ "$KEEP" = "0" ]; then
  rm -rf "$ROOT"
else
  say "the world is left in $ROOT"
fi
exit $STATUS
