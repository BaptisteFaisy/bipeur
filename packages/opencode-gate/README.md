# The agent gate

One gate, every agent: opencode, Claude Code, and any tool that runs a shell
hook before a tool call. The gate classifies what the agent is about to do
with the rules of the Central (`.bipeur/rules.yaml`, via `@bipeur/core`): the
command runs, is refused outright, or opens a page and waits for you.

## opencode

`opencode` loads every plugin in `.opencode/plugins/`. The adapter is
`plugin.ts` — see `docs/AGENT-DEMO.md` for the demo and the exact flow.

## Claude Code

Build the hook, then register it once in `~/.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash|Edit|Write",
        "hooks": [
          { "type": "command", "command": "node /ABSOLUTE/PATH/packages/opencode-gate/dist/claude-hook.js" }
        ]
      }
    ]
  }
}
```

A template lives in `claude/settings.example.json`. The hook reads the tool
event from stdin and answers `allow` / `deny` on stdout; the page is opened by
the `bip` CLI, so it is a real page with a real signed decision.

Same story for Cursor, Codex CLI or Zed: point their tool hook at the same
`claude-hook.js` (or wrap the shared `evaluateClaude`) — the protocol is the
same classify-then-ask in every shell.