# central-core — design

Route: requirements first. This document describes what exists in
`packages/core` today, then the module layout the Central follows.

## 1. Where the code lives

| Module | Lines | Responsibility | Requirement |
|---|---|---|---|
| `packages/core/src/types.ts` | 201 | Domain vocabulary: `Risk`, `Verb`, `PageState`, `PageRecord`, `AuditEvent`. Pure types and constants. | BIP-F-05, BIP-F-12 |
| `packages/core/src/ascii.ts` | 127 | Printable-ASCII discipline: transliteration, `toLineText`, `splitScreen` (4 × 20), alias normalisation. | BIP-P-01, BIP-N-08 |
| `packages/core/src/canonical.ts` | 32 | Deterministic JSON: sorted keys, no `undefined`, stable number form. Everything signed or hashed goes through it. | BIP-F-01, BIP-F-18 |
| `packages/core/src/codes.ts` | 70 | The eight code families, their verbs, their default risk, `911` as emergency. | BIP-F-04 |
| `packages/core/src/line.ts` | 107 | `composeLine`, `truncateSubject`, `buildDetailScreens`. | BIP-F-02, BIP-P-01, BIP-P-02 |
| `packages/core/src/states.ts` | 87 | Transition table, `canTransition`, `applyTransitions`, `stateGraphDot`. | BIP-F-05, BIP-P-03 |
| `packages/core/src/budget.ts` | 152 | `AttentionBudget` sliding window, `bypassesAttention`, quiet-hours predicate. | BIP-F-09, BIP-F-10, BIP-P-07, BIP-P-08 |
| `packages/core/src/rules.ts` | 287 | Rules file schema, `parseRules`, `classify`, `splitCommand`, `resolveRisk`. | BIP-F-04, BIP-P-09 |
| `packages/core/src/decision.ts` | 69 | `DecisionClaims`, `decisionSigningString`, deadline. | BIP-F-18, BIP-P-05, BIP-P-06 |
| `packages/core/src/schema.ts` | 131 | Zod schemas for every inbound payload of the API. | BIP-F-01, BIP-F-03 |
| `packages/core/src/time.ts` | 70 | `parseDuration`, `formatDuration`, `REMINDER_DELAYS_MS` (2, 5, 15 min). | BIP-F-08 |
| `packages/core/src/node.ts` | 89 | Node-only: `fingerprint`, `sha256Hex`, `hashToken`, `verifyDecision`, ids, tokens. | BIP-F-01, BIP-N-03 |

`src/index.ts` re-exports everything except `node.ts`: the browser bundle never
pulls a `node:` import. `@bipeur/core/node` is the second entry point.

## 2. The pipeline of one request

```
POST /v1/pages
  ├─ 1. auth         hashToken(bearer) == sources.token_hash, constant time   (BIP-N-03)
  ├─ 2. schema       zod parse; question > 80 chars → 422 + excess            (BIP-F-03)
  ├─ 3. fingerprint  sha256(canonicalize(payload))                            (BIP-F-01)
  ├─ 4. dedupe       same fingerprint + same station + pending → reuse        (BIP-F-11)
  ├─ 5. classify     rules.yaml: allow | deny | page(code, risk)              (BIP-F-04)
  │                  composite command: split, classify each, worst wins      (BIP-P-09)
  ├─ 6. risk         resolveRisk(computed, declared) = max                    (BIP-F-04)
  ├─ 7. line         composeLine({code, station, verb, subject, fingerprint}) (BIP-F-02)
  ├─ 8. admission    budget + quiet hours, red and family 9 bypass            (BIP-F-09/10)
  ├─ 9. persist      INSERT pages, INSERT events(page.created)                (BIP-F-12)
  └─10. deliver      WS broadcast, Web Push if closed, events(page.delivered)
```

Steps 1 to 7 are pure functions of `packages/core`; steps 8 to 10 are the
Central's, and only they touch the clock and the store.

## 3. Data model

SQLite, one file (`BIPEUR_DB`), one process (BIP-N-09). The store sits behind
`packages/central/src/store/` (an interface plus a `node:sqlite` implementation)
so a restart never loses a pending page (BIP-P-12).

### `sources`

`id`, `alias` (6 chars), `kind` (`kiro-hook` | `mcp` | `crew` | `snpp` | `cli` |
`simulator`), `token_hash`, `last_seen_at`, `rate_limit_per_minute`.

The alias is the only thing a page shows of a source; it is normalised by
`normalizeAlias` and can never be longer than the `STATION` field.

### `devices`

`id`, `name`, `public_key_jwk`, `push_subscription`, `paired_at`, `revoked_at`,
`mask_on_lock_screen`.

A device row is created by pairing (BIP-F-15) and never deleted: revocation sets
`revoked_at`, so the audit log keeps pointing at something.

### `pages`

`id`, `source_id`, `kind` (`tool` | `question`), `code`, `risk`, `line`,
`detail` (JSON, 3 screens max), `payload` (JSON), `payload_sha256`, `options`
(JSON, 4 max), `state`, `created_at`, `delivered_at`, `read_at`, `expires_at`,
`dedupe_key`, `callback_url`, `reminder_step`.

`line` is stored, not recomputed: what the human saw is what is audited. The
payload is stored because the hook needs it back on resumption, but it never
reaches a log line (BIP-N-03).

### `decisions`

`page_id`, `device_id`, `verdict` (`approve` | `deny` | `choice`), `choice_code`,
`nonce`, `signature`, `decided_at`, `latency_ms`.
`UNIQUE(page_id)` is the database half of BIP-P-04; the in-process guard is the
other half.

### `events` (append-only)

`id`, `ts`, `type`, `page_id`, `source_id`, `device_id`, `fingerprint`, `data`.
No `UPDATE`, no `DELETE` before retention. Types: `page.created`,
`page.delivered`, `page.read`, `page.decided`, `page.expired`, `page.cancelled`,
`page.held`, `decision.rejected`, `beep.requested`, `notice.logged`,
`device.paired`, `device.revoked`, `source.registered`, `budget.flushed`,
`quiet.suppressed`, `central.started`.

### `digest`

`id`, `source_id`, `ts`, `line` — the events that did not deserve a page
(BIP-F-13). One row per notice, 80 characters, same ASCII rule as a page.

### `nonces`

`nonce`, `device_id`, `seen_at`. Insert fails on replay → the decision is
refused with `decision.rejected`. Rows older than the decision TTL are pruned.

## 4. State transitions

```
queued ──▶ delivered ──▶ read ──▶ decided
   │            │          │
   ├─▶ expired  ├─▶ decided│
   ├─▶ cancelled├─▶ expired│
   │            ├─▶ cancelled
   │            └─▶ read
```

`states.ts` holds the table; `applyTransitions` folds a requested sequence and
ignores illegal moves, so a duplicated event never corrupts a page. The graph is
regenerated into the README by the `state-machine-guard` hook from
`stateGraphDot()` — one source of truth, no hand-edited diagram.

## 5. Architectural decisions and why

1. **One process, one SQLite file.** `node:sqlite` rather than
   `better-sqlite3`: same file format, no native build, the container stays under
   200 MB and CI inside its 5-minute budget (BIP-N-09). The store interface keeps
   the door open.
2. **The line is composed by the Central, never by the agent.** The honesty rule
   is an architecture decision, not a UI one: `composeLine` takes facts only, and
   `agent_says` is a separate field consumed only by `buildDetailScreens`.
3. **Risk is computed, then floored.** `resolveRisk(computed, declared)` returns
   the max, so a source can escalate its own request but never de-escalate. This
   makes the "agent declares it is harmless" attack impossible instead of
   merely discouraged.
4. **Pure core, impure shell.** Every rule of the product (line, codes, states,
   budget, claims) is a pure function in `packages/core`, so it is testable with
   fast-check without a clock, a socket or a database.
5. **The audit log is the only source of metrics.** No counters in memory: every
   figure of the dashboard and of the video is a `SELECT` over `events`.
6. **Fail closed everywhere.** Store unavailable, rules file unreadable, push
   service down: the request is refused with an explicit reason and an audit
   event. A page that expires is a refusal (BIP-F-07).

## 6. Security parades implemented here

| Parade | Where |
|---|---|
| Token stored hashed, compared in constant time | `hashToken` (`core/node.ts`), store lookup |
| No payload in logs | `AuditEvent` carries `fingerprint` only; the logger prints the event type |
| Signed decision, replayed nonce refused | `decisionSigningString` + `nonces` table |
| Fingerprint binding | `decisions.page_id` + stored `payload_sha256` |
| Budget enforced server-side | `AttentionBudget` in the Central, not in the pager |
| Printable ASCII only | `toLineText` on every composed screen |
| Retention bounded | `BIPEUR_RETENTION_DAYS`, default 30 |

## 7. Test plan

- `packages/core/test/*.props.test.ts` — BIP-P-01, 02, 03, 07, 08, 09, each with
  `{ numRuns, seed }` recorded.
- `packages/central/test/*.props.test.ts` — BIP-P-04, 05, 06, 10, 12 (arrive
  with the Central implementation, lot A1).
- Unit tests name their requirement: `describe('BIP-P-07 — …')`.
- Clock, store and push are injected; no test sleeps (see `testing.md`).
