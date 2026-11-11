# central-core — tasks

Ordered. A task is done when its **evidence** exists in the repository — a test,
a log line, a file. Never a claim.

## A1 — the shared contract (`packages/core`)

- [x] 1. Domain vocabulary — `types.ts`: `Risk`, `Verb`, `PageState`,
  `PageRecord`, `AuditEvent`, `Metrics`. **Evidence:** file tracked.
- [x] 2. ASCII discipline — `ascii.ts`: transliteration, `toLineText`,
  `splitScreen`. **Evidence:** `line.props.test.ts` BIP-P-01.
- [x] 3. Code families — `codes.ts`: eight families, verbs, default risk,
  `isUrgentCode`. **Evidence:** `rules.props.test.ts` BIP-P-09.
- [x] 4. Line composer — `line.ts`: `composeLine`, `truncateSubject`,
  `buildDetailScreens`. **Evidence:** BIP-P-01 and BIP-P-02 green.
- [x] 5. State machine — `states.ts`: transition table, `applyTransitions`,
  `stateGraphDot`. **Evidence:** `states.props.test.ts` BIP-P-03.
- [x] 6. Budget and quiet hours — `budget.ts`. **Evidence:** BIP-P-07 and
  BIP-P-08 green.
- [x] 7. Rules engine — `rules.ts`: `splitCommand`, `classify`, `resolveRisk`.
  **Evidence:** BIP-P-09 green, counter-example on `curl … | sh` recorded in
  `KIRO_JOURNAL.md`.
- [x] 8. Signed decision claims — `decision.ts` + `canonical.ts`.
  **Evidence:** `node.test.ts` verifies a round trip and a tampered claim.
- [x] 9. Wire schemas — `schema.ts`. **Evidence:** a `422` on a 81-character
  question is a unit test.

## A1 — the Central (`packages/central`)

- [ ] 10. Store interface + `node:sqlite` implementation, migrations, WAL.
  **Evidence:** `packages/central/src/store/sqlite.ts`, restart test green.
- [ ] 11. `POST /v1/pages`: auth, schema, fingerprint, dedupe, classify, line,
  admission, persist, deliver. **Evidence:** BIP-F-01 and BIP-F-11 tests.
- [ ] 12. `GET /v1/pages/{id}/decision?wait=N` long poll. **Evidence:** the
  poll resolves under 200 ms after a decision.
- [ ] 13. `DELETE /v1/pages/{id}` cancellation. **Evidence:** `page.cancelled`
  event, pager queue drops the page.
- [ ] 14. `POST /v1/notices` digest. **Evidence:** `notice.logged`, no `page.*`.
- [ ] 15. Decision endpoint: signature, device, fingerprint, deadline, nonce.
  **Evidence:** BIP-P-04, BIP-P-05, BIP-P-06 green; `decision.rejected` on a
  tampered fingerprint.
- [ ] 16. Audit writer: append-only, fingerprint only, retention job.
  **Evidence:** `GET /v1/audit` returns events; no payload string in any row.
- [ ] 17. WebSocket stream `/v1/stream` with per-device fan-out.
  **Evidence:** a delivered page reaches an open pager in under 2 s (BIP-N-01).
- [ ] 18. Expiry and reminders driven by an injected clock. **Evidence:**
  fake-clock test, `page.expired` with no approval event (BIP-F-07).

## A4 — budget, reminders, simulator

- [ ] 19. Wire `AttentionBudget` into admission and flush held pages when a
  slot frees. **Evidence:** seven green requests in a minute → six deliveries,
  one hold, then a grouped delivery (BIP-F-09).
- [ ] 20. Quiet hours: suppress green and amber, log `quiet.suppressed`.
  **Evidence:** BIP-F-10 test at 23:30 with a fake clock.
- [ ] 21. Reminder scheduler at 2, 5 and 15 minutes. **Evidence:** three
  `page.delivered` events for one unread page, then silence (BIP-F-08).
- [ ] 22. Simulator: three fictional stations (`fw`, `a`, `b`), isolated space
  per visitor, wiped after 24 h. **Evidence:** parcours P7 played by Playwright.

## A5 — operations

- [ ] 23. `tools/smoke-central.mjs` boots the Central and checks the API.
  **Evidence:** runs inside the `build` CI job.
- [ ] 24. Restart without loss: `BIPEUR_DB` reload, pending pages resumed.
  **Evidence:** BIP-P-12 green.

## Traceability

| Requirement | Task | Property |
|---|---|---|
| BIP-F-01, F-02, F-03 | 11 | BIP-P-01, BIP-P-02 |
| BIP-F-04 | 7, 11 | BIP-P-09 |
| BIP-F-05 | 5, 10 | BIP-P-03 |
| BIP-F-06, F-07 | 12, 18 | BIP-P-06 |
| BIP-F-08, F-09, F-10 | 19, 20, 21 | BIP-P-07, BIP-P-08 |
| BIP-F-11 | 11 | BIP-P-10 |
| BIP-F-12, F-13, F-14 | 13, 14, 16 | — |
| BIP-N-02 | 24 | BIP-P-12 |
