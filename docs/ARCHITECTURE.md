# Architecture

One process, one SQLite file, one URL. Everything below follows from that
sentence: if a piece needs a second daemon, a message broker or a cloud account,
it does not belong in Beeper.

## 1. The picture (A.9)

```
Kiro IDE / CLI ── hook "before tool" ─────┐
Kiro Crew ────── app (event) ─────────────┤
MCP client ───── page_human ──────────────┼─ HTTP ─▶ ┌────────────────┐ ◀─ WebSocket ─▶ ┌──────────┐
Scripts ──────── SNPP :4440, bip ─────────┘          │    Central     │    Web Push     │  Beeper  │
                                                     │ rules · queue  │ ◀─ signed ────  │  (PWA)   │
                                                     │ audit · SQLite │    decision     └──────────┘
                                                     └────────────────┘
```

Read it in three columns:

| Column | What it is | What it may not do |
|---|---|---|
| **Left** — the sources | A Kiro session, a Crew app, an MCP client, a shell script speaking SNPP or `bip` | Compose a line, declare a risk level, decide anything |
| **Middle** — the Central | One Node process: rules, line composer, queue, budget, audit, store | Launch an agent, keep state in memory that is not in SQLite |
| **Right** — the human | The pager: a PWA on the phone, a lock screen, a memory of 50 pages | Decide anything the Central did not propose |

## 2. The packages

| Package | Role | Depends on |
|---|---|---|
| `packages/core` | The shared contract. Line composer, code families, state machine, budget, rules engine, decision claims, wire schemas. Pure functions; `src/index.ts` is browser-safe, `@bipeur/core/node` adds hashing and ECDSA verification. | `yaml`, `zod` |
| `packages/central` | Hono API, `node:sqlite` store, WebSocket stream, Web Push, audit log, digest, simulator, dashboard. | `core`, `hono`, `ws`, `web-push` |
| `packages/pager` | React 19 + Vite PWA: the screen, the keys, pairing, the signed decision, offline behaviour, memory, settings. | `core`, `react` |
| `packages/hook` | `bip-hook` (Kiro `PreToolUse`) and `bip-notice` (end of turn). | `core` |
| `packages/mcp-server` | `page_human`, `page_wait`, `page_cancel` over stdio. | `core`, MCP SDK |
| `packages/snpp` | RFC 1861 gateway over plain TCP. | `core` |
| `packages/cli` | `bip ask "…" --yes-no --ttl 10m` → exit 0 / 1 / 3. | `core` |
| `packages/crew-app` | Kiro Crew app: relays approval events, resolves them from a signed decision. | `core`, `ws` |

Rule of the house: a package that needs a piece of product logic imports it from
`core`. Two implementations of `composeLine` would be two products.

## 3. Data model, table by table

SQLite, one file (`BIPEUR_DB`), behind `packages/central/src/store/` so the driver
can change without touching the API.

### `sources`

| Column | Why |
|---|---|
| `id`, `alias` (≤ 6 chars) | The alias is what the page prints; it is normalised, never truncated at display time |
| `kind` | `kiro-hook`, `mcp`, `crew`, `snpp`, `cli`, `simulator` — used for metrics, never for trust |
| `token_hash` | `hashToken(token)`, compared in constant time; the clear token exists only in the station's environment |
| `last_seen_at`, `rate_limit_per_minute` | Rate limiting is per station, server-side |

### `devices`

`id`, `name`, `public_key_jwk`, `push_subscription`, `paired_at`, `revoked_at`,
`mask_on_lock_screen`. Rows are never deleted: revocation sets `revoked_at`, so
an old audit row still points at a device that exists.

### `pages`

| Column | Why |
|---|---|
| `id`, `source_id`, `kind` | `tool` or `question` — decides whether the line comes from the payload or from a written question |
| `code`, `risk`, `line` | Computed once, at creation, and stored: what the human saw is what is audited |
| `detail` (JSON) | Screens 2…N, 80 characters each: three is what a page usually needs, and a long text continues on the extra screens instead of being cut |
| `payload` (JSON), `payload_sha256` | The hook needs the payload back on resumption; the hash is the fingerprint used by the decision |
| `options` (JSON) | Up to four pre-seeded replies (`A`–`D`) |
| `state` | `queued`, `delivered`, `read`, `decided`, `expired`, `cancelled` |
| `created_at`, `delivered_at`, `read_at`, `expires_at` | Every latency in the product is a subtraction of two of these |
| `dedupe_key` | Idempotency: same key + same station + pending ⇒ one page |
| `callback_url` | The only clickable address, declared by the station, validated `http(s)` |

### `decisions`

`page_id` (**UNIQUE**), `device_id`, `verdict`, `choice_code`, `nonce`,
`signature`, `decided_at`, `latency_ms`. The unique index is half of "at most one
accepted decision" (BIP-P-04); the in-process guard is the other half.

### `events` — append-only

`id`, `ts`, `type`, `page_id`, `source_id`, `device_id`, `fingerprint`, `data`.
No `UPDATE`, no `DELETE` before retention (30 days by default). This table is the
only source of metrics: no counter lives in memory, so a restart never resets a
number and the video can quote a `SELECT`.

### `digest`

`id`, `source_id`, `ts`, `line` — the events that did not deserve a page
(BIP-F-13). Same 80-character ASCII rule.

### `nonces`

`nonce`, `device_id`, `seen_at`. The insert fails on replay, which is exactly the
check we want; rows older than the decision TTL are pruned.

## 4. State transitions

```
queued ──▶ delivered ──▶ read ──▶ decided
   │            │           │
   ├─▶ expired  ├─▶ decided │
   ├─▶ cancelled├─▶ expired │
   │            ├─▶ cancelled
   │            └─▶ read
```

`packages/core/src/states.ts` owns the table; `applyTransitions` folds a sequence
of requested moves and ignores illegal ones, so a duplicated WebSocket frame
cannot corrupt a page. `stateGraphDot()` produces the diagram in the README, and
the `state-machine-guard` hook regenerates it from the same source — the diagram
is never hand-edited.

A final state never changes again. An expired page is a refusal: `on_expire` is
`deny`, and nothing in the pipeline can turn an expiry into an approval.

## 5. One signed decision, end to end

```
1. Agent          bip-hook reads {hook_event_name, cwd, tool_name, tool_input}
2. Hook           rules.yaml → allow (exit 0) | deny (exit 2) | page
3. Hook  ──POST /v1/pages──▶ Central
4. Central        canonicalize(payload) → sha256 → fingerprint
                  classify → code + risk (max of segments)
                  composeLine(code, station, verb, subject, #fp)
                  budget + quiet hours (red and 9xx bypass)
                  INSERT pages, INSERT events(page.created)
5. Central ──WS/Push──▶ Pager        "310 a PUSH main>origin 3 commits #07c2"
6. Human          reads the line, presses ✔ (red: one-second hold)
7. Pager          claims = {page_id, fingerprint, verdict, choice, nonce,
                            expires_at, device_id}
                  sig = ECDSA-P256(deviceKey, canonicalize(claims))
8. Pager  ──POST /v1/pages/{id}/decision {claims, sig}──▶ Central
9. Central        verify signature → device known and not revoked
                  → claim fingerprint == page fingerprint
                  → deadline not passed → nonce never seen
                  any failure ⇒ events(decision.rejected), nothing changes
                  success ⇒ INSERT decisions, events(page.decided, latency)
10. Hook          long poll returns; re-checks the fingerprint; exit 0
11. Agent         the tool runs, or does not, with a reason
```

Step 10 is the detail that makes the whole thing safe: the hook is the component
that resumes a real command, so it verifies again rather than trusting the
Central's word. An approval can therefore never be applied to another action than
the one displayed — the *orphan approvals* metric is zero by construction, not by
testing.

## 6. What is deliberately absent

No message broker, no second database, no cloud dependency, no account, no
microservice. The failure mode we optimised for is "the Central is down": hooks
fail closed, the pager shows `OFFLINE`, and nothing is silently approved.
