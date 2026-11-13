# pager-pwa — tasks

Lot A2. Ordered by dependency: key first (nothing works without it), then the
screen, then the gesture, then the memory.

- [ ] 1. `crypto/deviceKey.ts` — generate a non-extractable P-256 pair, persist
  the handle in IndexedDB, expose `sign(claims)`. **Evidence:** unit test that a
  re-generated handle signs and the public JWK verifies with `@bipeur/core/node`.
- [ ] 2. `pairing/usePairing.ts` + pairing screen — QR read, `POST /v1/devices`,
  five-minute TTL, single use. **Evidence:** Playwright P1.
- [ ] 3. `pager/Screen.tsx` — 4 × 20 grid from `splitScreen`, `aria-live`,
  real text nodes. **Evidence:** component test on a real composed line.
- [ ] 4. `pager/RiskLamp.tsx` — colour + shape + text alternative.
  **Evidence:** test asserting the accessible name per risk.
- [ ] 5. `pager/Keys.tsx` — ✔ / ✖ / ▼, A–D, keyboard equivalents.
  **Evidence:** test per key binding (BIP-F-17).
- [ ] 6. `pager/HoldToConfirm.tsx` — one-second hold for red, fake clock.
  **Evidence:** 900 ms does nothing, 1000 ms approves (BIP-F-17).
- [ ] 7. Detail screens 2–4 with `AGENT SAYS:` on screen 4 only.
  **Evidence:** test showing screens 1–3 unchanged when `agent_says` changes.
- [ ] 8. `transport/ws.ts` — WebSocket, backoff, offline detection.
  **Evidence:** test that a closed socket shows `OFFLINE` (BIP-F-22).
- [ ] 9. `transport/decide.ts` — claims, canonicalise, sign, POST.
  **Evidence:** test comparing the signed string to `decisionSigningString`.
- [ ] 10. `memory/store.ts` — last 50 pages with decision and latency.
  **Evidence:** eviction test at 51 (BIP-F-20).
- [ ] 11. `settings/store.ts` — sound off, vibration, quiet hours, budget,
  masking. **Evidence:** defaults test (BIP-F-21).
- [ ] 12. Service worker + manifest + Web Push handler.
  **Evidence:** installable build, push received in a closed tab (BIP-F-19).
- [ ] 13. "Call back" on a declared `callback_url`. **Evidence:** test that a
  non-declared URL is not clickable (BIP-F-23).
- [ ] 14. Playwright P2 (approve) and P3 (destructive refusal, hold).
  **Evidence:** `e2e/` scenarios, outside PR CI.

## Traceability

| Requirement | Tasks |
|---|---|
| BIP-F-15 | 1, 2 |
| BIP-F-16, F-17 | 3, 4, 5, 6 |
| BIP-F-18 | 1, 9 |
| BIP-F-19 | 12 |
| BIP-F-20, F-21 | 10, 11 |
| BIP-F-22 | 8 |
| BIP-F-23 | 13 |
| BIP-N-05 | 3, 4 |
| BIP-N-06 | 11, 12 |
