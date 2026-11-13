# central-core — requirements

- **Route:** requirements first (A.13). The requirement text is stable and the
  design follows it; nothing here is discovered while coding.
- **Scope:** the Central — `packages/core` (the shared contract) and
  `packages/central` (HTTP API, store, audit, budget, simulator).
- **Covers:** BIP-F-01 … BIP-F-14, properties BIP-P-01 … BIP-P-10 and BIP-P-12.
- **Lot:** A1 (core), completed by A4 (budget, reminders, expiry, simulator).

Source: the Kiroween specification, section A.7. The acceptance criteria were
already written in EARS (0.8) and are carried over unchanged in substance; the
wording is English because the submission is (BIP-N-08).

## Vocabulary

| Term | Meaning |
|---|---|
| Page | One decision request: one line, one code, pre-seeded replies. |
| Source | The emitter of a request, identified by a short alias (`fw`, `a`, `b`). |
| Station | Alias of a source, 6 characters max, as printed on the line. |
| Fingerprint | SHA-256 of the canonical form of the exact payload. |
| Code | Three digits: the family of the request and its nature (A.6). |
| Risk | `green`, `amber`, `red` — computed by rules, never declared by the agent. |

## Functional requirements

### BIP-F-01 (I) — Page creation

WHEN an authenticated source posts a page request (kind, payload, time to live)
to `POST /v1/pages`, THE SYSTEM SHALL record the page, compute its fingerprint
and answer in under 200 ms with its identifier and its state.
IF the source is not authenticated, THEN THE SYSTEM SHALL answer `401` and
record nothing.

- Accept: an unauthenticated `POST /v1/pages` leaves the `pages` table unchanged
  and returns `401`.
- Accept: the response body carries `id`, `state` and `fingerprint`.

### BIP-F-02 (I) — Line composed by the Central

WHEN the page kind is `tool`, THE SYSTEM SHALL compose the line from the
payload alone, without reusing any free text produced by the agent.

- Accept: a payload whose `agent_says` contains a forged summary produces the
  same line as the same payload without `agent_says`.
- Accept: `agent_says` appears only on detail screen 4, prefixed `AGENT SAYS:`.

### BIP-F-03 (I) — Length constraint

IF a question exceeds 80 characters or contains a non-printable character,
THEN THE SYSTEM SHALL refuse it with `422` and the number of excess
characters, so the agent can rewrite it.

- Accept: the `422` body carries `excess` as an integer.

### BIP-F-04 (I) — Risk classification

WHEN a tool page is created, THE SYSTEM SHALL assign its level from the rules in
`.bipeur/rules.yaml` and keep the highest level when several rules apply.
A composite command (`&&`, `;`, `|`) SHALL be split and each segment classified.
A source SHALL NOT lower the computed level.

- Accept: `resolveRisk(computed, declared)` returns the maximum of the two.
- Accept: a segment that matches `deny` refuses the whole command.

### BIP-F-05 (I) — State machine

A page follows `queued → delivered → read → decided`, or ends in `expired` or
`cancelled`. THE SYSTEM SHALL refuse every other transition, and a final state
SHALL NOT change again.

- Accept: `transition('decided', 'delivered')` throws `IllegalTransitionError`.

### BIP-F-06 (I) — Waiting for the decision

WHEN a source calls `GET /v1/pages/{id}/decision?wait=N`, THE SYSTEM SHALL
answer as soon as a decision exists, or after N seconds with the current state.

- Accept: the long poll resolves in under 200 ms after a decision is accepted.

### BIP-F-07 (I) — Expiry

WHEN the time to live elapses without a decision, THE SYSTEM SHALL move the page
to `expired` and return a refusal to the source. THE SYSTEM SHALL NEVER approve
an amber or red page by default.

- Accept: an expired page produces a `page.expired` event and no approval event.

### BIP-F-08 (S) — Reminders

WHILE a delivered page has not been read, THE SYSTEM SHALL re-deliver it at 2, 5
and 15 minutes, then stop.

- Accept: the reminder schedule is data (`REMINDER_DELAYS_MS`), driven by an
  injected clock in tests.

### BIP-F-09 (I) — Attention budget

WHILE the number of pages delivered in the sliding hour reaches the budget (six
by default), THE SYSTEM SHALL hold new green and amber pages and deliver them
grouped as soon as a slot frees. Red pages and family 9 always get through.

- Accept: seven green requests in one minute give six deliveries and one hold.
- Accept: a red page created during a full budget is delivered immediately.

### BIP-F-10 (S) — Quiet hours

WHILE the local time is inside the quiet window, THE SYSTEM SHALL deliver only
red and family 9 pages, and record the others in the digest with their default
refusal.

- Accept: a green page created at 23:30 with quiet hours on writes
  `quiet.suppressed` and no `page.delivered`.

### BIP-F-11 (I) — Deduplication

WHEN a source sends a request whose fingerprint matches a page still pending for
the same station, THE SYSTEM SHALL attach it to the existing page.

- Accept: two identical requests give one page and one `id`.

### BIP-F-12 (I) — Audit log

THE SYSTEM SHALL append, in write-only fashion, every creation, delivery, read,
decision, expiry and cancellation, with time, station, fingerprint, device and
latency. No entry SHALL be modified or deleted before the retention window ends.

- Accept: `DELETE` on `events` is not exposed; retention is 30 days by default.

### BIP-F-13 (S) — Digest

WHEN a source posts a notice to `POST /v1/notices`, THE SYSTEM SHALL append it to
the station digest without paging.

- Accept: a notice creates no `page.*` event.

### BIP-F-14 (S) — Cancellation

WHEN the source cancels a pending page, THE SYSTEM SHALL remove it from the pager
and record it as `cancelled`.

- Accept: a cancelled page is a final state and the pager drops it from the queue.

## Non-functional requirements (this lot)

| Id | Priority | Requirement |
|---|---|---|
| BIP-N-01 | I | A page is delivered in under 2 s at p95 on a local network; the rule-allowed fast path of the hook adds under 50 ms. |
| BIP-N-02 | I | A restart of the Central loses no pending page; a hook reconnecting with the same idempotency key finds its page. |
| BIP-N-03 | I | One token per station, stored hashed; rate limiting per station; no payload in application logs, fingerprints only. |
| BIP-N-04 | I | Self-hosted by default; 30-day retention, configurable; a notification may be reduced to the code and the station. |
| BIP-N-09 | I | One process and one SQLite file; container image under 200 MB; backup by copying the file. |

## Properties

| Id | Property | Test |
|---|---|---|
| BIP-P-01 | For any payload, the composed line is at most 80 printable characters and ends with `#` plus the first four characters of the fingerprint. | `packages/core/test/line.props.test.ts` |
| BIP-P-02 | Truncation never removes the code, the station or the verb, and keeps the first word of the subject. | `packages/core/test/line.props.test.ts` |
| BIP-P-03 | For any sequence of events, a page only walks edges of the graph, and a final state is stable. | `packages/core/test/states.props.test.ts` |
| BIP-P-04 | A page receives at most one accepted decision, however many arrive concurrently. | `packages/central/test/decide.props.test.ts` |
| BIP-P-05 | A decision whose fingerprint differs from the page's is never accepted. | `packages/central/test/decide.props.test.ts` |
| BIP-P-06 | A decision received after its deadline never results in an approval. | `packages/central/test/decide.props.test.ts` |
| BIP-P-07 | Over any sliding hour, the number of green and amber pages delivered never exceeds the budget. | `packages/core/test/budget.props.test.ts` |
| BIP-P-08 | A red page, or one of family 9, is never held by the budget or by quiet hours. | `packages/core/test/budget.props.test.ts` |
| BIP-P-09 | The level of a composite command is the maximum of its segments; adding a segment never lowers it. | `packages/core/test/rules.props.test.ts` |
| BIP-P-10 | Two requests with the same fingerprint and the same station, while the first is pending, give one page. | `packages/central/test/dedupe.props.test.ts` |
| BIP-P-12 | After a simulated stop and restart at any instant, no pending page is lost or duplicated. | `packages/central/test/restart.props.test.ts` |

## Out of scope

The pager UI (BIP-F-15 … 23, spec `pager-pwa`), the adapters (BIP-F-24 … 26,
spec `kiro-adapters`), SNPP (BIP-F-28, spec `snpp-gateway`), the dashboard
(BIP-F-30 … 32, spec `central-dashboard`).

## Open questions

1. Default budget of six pages per hour — to confirm after a week of real use.
2. The English product name: "Beeper", "Pager for Agents", something else.
