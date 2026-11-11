---
inclusion: always
---

# Testing — what a green bar means

## Layers

| Layer | Tool | Runs |
|---|---|---|
| Unit | Vitest (`unit` project) | every PR |
| Properties | fast-check (`props` project) | every PR |
| Pager components | Vitest + happy-dom (`pager` project) | every PR |
| Boot smoke | `tools/smoke-central.mjs` | every PR, inside the `build` job |
| End to end (P1…P7) | Playwright, `e2e/` | `main` and `workflow_dispatch` only |

## Rules

1. **A test names the requirement it proves** in its `describe` title:
   `BIP-P-07 — at most budget green/amber pages per sliding hour`.
2. **Property tests record their seed** (`{ numRuns, seed }`) so a
   counter-example can be replayed, and every counter-example found is written
   into `KIRO_JOURNAL.md` with its fix.
3. **Time is injected, never read.** Every clock-dependent unit takes
   `now: () => number` or an explicit timestamp; a test never sleeps to prove a
   timeout. Expiry, reminders, the sliding budget and quiet hours are all
   driven by a fake clock.
4. **No sound, no network, no real device** in unit or property tests. Web Push
   is behind an interface; the test double records calls. The SNPP gateway is
   tested against an in-process TCP pair, not the loopback port 444.
5. **Fail-closed paths are tested too**: Central unreachable, expired page,
   tampered fingerprint, replayed nonce, revoked device.
6. **Deterministic identifiers in fixtures.** Randomness comes from fast-check,
   not from `Math.random()` in a test.
7. A serious bug found during construction gets **its own bug-fix spec** in
   `.kiro/specs/`, kept in the repository: it is evidence of Kiro usage.

## The twelve properties

| Id | Property | Where |
|---|---|---|
| BIP-P-01 | Line ≤ 80 printable ASCII, ends with `#` + 4 hex of the fingerprint | `packages/core/test/line.props.test.ts` |
| BIP-P-02 | Truncation keeps code, station, verb and the first word of the subject | same |
| BIP-P-03 | Only graph edges; a final state is stable | `packages/core/test/states.props.test.ts` |
| BIP-P-04 | At most one accepted decision per page, however many arrive | `packages/central/test/decide.props.test.ts` |
| BIP-P-05 | A decision on another fingerprint is never accepted | same |
| BIP-P-06 | A decision past its deadline never approves | same |
| BIP-P-07 | Sliding hour never exceeds the budget for green+amber | `packages/core/test/budget.props.test.ts` |
| BIP-P-08 | Red and family 9 are never held | same |
| BIP-P-09 | Composite risk = max of segments; monotone | `packages/core/test/rules.props.test.ts` |
| BIP-P-10 | Same fingerprint + same station ⇒ one page | `packages/central/test/dedupe.props.test.ts` |
| BIP-P-11 | The SNPP parser always answers an RFC code and never throws | `packages/snpp/test/parser.props.test.ts` |
| BIP-P-12 | Stop/restart at any instant loses and duplicates nothing | `packages/central/test/restart.props.test.ts` |

## Acceptance

The lot is done when: `pnpm typecheck`, `pnpm lint`, `pnpm test` and
`pnpm build` are green; the properties above that belong to the lot pass with
their seed recorded; the acceptance checklist of the lot (A.17 for the whole
project) has a file or a log line as evidence for each item — **never** a claim.
