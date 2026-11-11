# central-dashboard — tasks (Quick Spec)

Lot A8, optional, last of the options (A.14).

- [ ] 1. `src/dashboard/queries.ts` — one query per metric, each returning its
  rows. **Evidence:** fixture audit log, known numbers asserted (BIP-F-30).
- [ ] 2. `GET /v1/audit` with filters (station, code, risk, state, since).
  **Evidence:** filter test, no payload text in the response (BIP-N-03).
- [ ] 3. `GET /v1/metrics`. **Evidence:** the five indicators of A.3 returned.
- [ ] 4. `src/dashboard/render.ts` — server-rendered HTML, AA contrast, sober.
  **Evidence:** snapshot of the three screens.
- [ ] 5. `POST /v1/rules/dry-run` — line, code, risk, matched rule, no event.
  **Evidence:** test asserting zero `page.*` events (BIP-F-32).
- [ ] 6. `src/demo/simulator.ts` — the five-scenario cast with jitter.
  **Evidence:** Playwright P7, parcours of A.5.
- [ ] 7. Space isolation and the 24 h sweep. **Evidence:** two spaces isolated,
  sweep test with a fake clock (BIP-F-31).

## Traceability

| Requirement | Tasks |
|---|---|
| BIP-F-30 | 1, 2, 3, 4 |
| BIP-F-31 | 6, 7 |
| BIP-F-32 | 5 |
