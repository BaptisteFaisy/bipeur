# crew-app — design (Quick Spec)

## 1. Shape

A Crew app is a package described by `app.json`: UI pages, background processes,
agents, MCP servers. `bipeur` ships two things and nothing else:

| Piece | File | Role |
|---|---|---|
| Page | `src/page.tsx` | the pager inside the Crew dashboard, at `/apps/bipeur` |
| Background process | `src/bg.ts` | subscribes to the Gateway, creates pages, resolves approvals |
| Manifest | `app.json` | declares both, plus the permission list |

`src/relay.ts` holds the mapping between a Gateway approval event and a page
payload; `src/resolve.ts` holds the call back to the Gateway. Both are pure
enough to test without a Gateway.

## 2. The loop

```
Gateway ── approval event ──▶ relay.ts ──▶ POST /v1/pages (kind: tool, source: crew)
                                              │
                                    pager decides (signed)
                                              ▼
Gateway ◀── resolve(page_id, approve|deny, reason) ◀── decision poll
```

The background process polls `GET /v1/pages/{id}/decision?wait=50` rather than
holding a WebSocket: a background process that dies and restarts must not lose a
decision, and the long poll is idempotent by construction.

## 3. Decisions and their reasons

1. **The app never decides.** It relays. Every verdict comes from a signed
   decision, so a bug in the app cannot approve anything.
2. **Expiry resolves as deny.** Same rule as everywhere else: an absent human is
   a refusal (BIP-F-07).
3. **The reason travels back.** A refusal without a reason teaches the agent
   nothing; the pager's detail screens supply it.
4. **Permissions minimal.** Approval and notification paths only — a Crew app
   that can read a workspace would be a much larger security surface.

## 4. Tests

`packages/crew-app/test/relay.test.ts` — event → page payload, one page per
event, dedupe key stable across restarts.
`packages/crew-app/test/resolve.test.ts` — approve, deny with reason, expiry as
deny, no double resolution.
