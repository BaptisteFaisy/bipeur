# kiro-adapters — design

Route: requirements first. Two adapters, one contract: turn a tool call into a
page, turn a decision into an exit code. Neither adapter knows how a line is
composed or how a risk is computed — both come from `packages/core`.

## 1. `bip-hook` — the Kiro `PreToolUse` hook

```
stdin: {hook_event_name:"PreToolUse", cwd, session_id, tool_name, tool_input}
  │
  ├─ 1. loadRules(BIPEUR_RULES ?? .bipeur/rules.yaml)      yaml, zod-validated
  ├─ 2. classify(tool_name, tool_input, cwd)               core/rules.ts
  │      allow → exit 0 immediately (no page, < 50 ms)      BIP-N-01
  │      deny  → stderr reason, exit 2                       BIP-F-24
  │      page  → continue
  ├─ 3. POST /v1/pages  (BIPEUR_URL, BIPEUR_TOKEN, dedupe_key = session:tool:hash)
  ├─ 4. GET  /v1/pages/{id}/decision?wait=<ttl>             long poll, one connection
  └─ 5. verifyDecision(publicKeyOfStation, claims)           re-check fingerprint
         approve → stdout "approved by <station>", exit 0
         deny    → stderr "refused: <reason>",  exit 2
         expired → stderr "no human decision",  exit 2       BIP-F-07
         error   → stderr "central unreachable", exit 2      fail closed
```

Module layout: `src/bin.ts` (entry, reads stdin, sets the exit code),
`src/rules.ts` (load + validate the file), `src/decide.ts` (poll and verify),
`src/output.ts` (the exact strings printed — tested verbatim), `src/notice.ts`
(`bip-notice`).

**Why the fingerprint re-check.** The Central already verified the signature, but
the hook is the component that resumes a real command. Re-checking that the
approved fingerprint equals the one it just sent costs one hash and closes the
window where a bug in the Central would become an executed command (A.10).

**Why `timeout: 0` in the hook file.** Kiro's default hook timeout is 60 s; the
page's own TTL (15 min by default) is the real bound, so the hook file disables
the timeout and the TTL governs. A hung page is refused by expiry, not by a
truncated wait.

**Idempotency.** `dedupe_key = sha256(session_id + tool_name + canonical(payload))`
so a hook that reconnects after a network blip finds its existing page instead of
paging twice (BIP-N-02, BIP-P-10).

## 2. `bip-notice` — the end-of-turn hook

Reads the same event shape, composes one line (`NEED`-free, family 5xx or plain
text), posts `POST /v1/notices`, exits `0` whatever happens. A notice never
blocks a turn (BIP-F-25).

## 3. `bipeur-mcp` — the MCP server

| Tool | Input | Output |
|---|---|---|
| `page_human` | `question` (≤ 80), `options` (2–4 × `{code, label}`), `detail` (≤ 240), `callback_url`, `ttl_seconds` (30–86400) | `{status, choice, page_id, latency_ms}` |
| `page_wait` | `page_id`, `wait_seconds` | same shape, for a page created earlier |
| `page_cancel` | `page_id` | `{cancelled: boolean}` |

Built on `@modelcontextprotocol/sdk`, transport stdio. `page_human` waits 50 s
then returns `pending` with the id: MCP clients time out around 60 s, and a tool
that times out teaches the agent that paging is unreliable. The agent can then
call `page_wait` — the page is still alive on the pager.

Validation happens twice: `zod` in the handler (clear message to the agent) and
the Central's own schema (the trust boundary).

## 4. Decisions and their reasons

1. **Exit code over stdout for refusals.** Kiro blocks a tool on a non-zero exit
   and forwards stderr to the agent: the reason reaches the agent where it acts.
2. **The rules are read twice, once per side.** The hook needs the fast path, the
   Central needs the authoritative classification. One file, one schema
   (`packages/core/src/rules.ts`), so the two can never drift.
3. **`pending` is a first-class MCP answer.** Pretending to block longer would
   break the client; refusing would waste the page already on the pager.
4. **No state in the adapter.** Both adapters are stateless processes; the
   idempotency key is the only memory, and it lives in the Central.

## 5. Tests

- `packages/hook/test/` — exit codes per outcome (approve, deny, expired,
  rejected fingerprint, Central down), fast path under 50 ms, output strings.
- `packages/mcp-server/test/` — tool schemas, the 50-second cap with a fake
  clock, `pending` answer, `page_cancel` on a decided page.
- One real-agent proof, lot A3: a Kiro session blocked by the hook, approved
  from the pager, resumed — `page.created` / `page.delivered` / `page.decided`
  with the same fingerprint, plus the agent log showing the resumption.
