# crew-app — tasks (Quick Spec)

Lot A7, optional, second of the options (A.14).

- [ ] 1. Read the Crew app manifest reference and write down the real fields in
  this file. **Evidence:** a note in `KIRO_JOURNAL.md` — the specification marks
  this **to verify**, so the verification is a deliverable.
- [ ] 2. `app.json` — name, page route, background process, permissions limited
  to approval and notification. **Evidence:** the manifest validates.
- [ ] 3. `src/relay.ts` — approval event → page payload, stable dedupe key.
  **Evidence:** unit test, one page per event (BIP-F-27).
- [ ] 4. `src/resolve.ts` — `approve` / `deny` with reason, expiry as deny.
  **Evidence:** unit test, no double resolution.
- [ ] 5. `src/bg.ts` — long poll with `wait=50`, retry with the same key.
  **Evidence:** a restart mid-wait resolves once.
- [ ] 6. `src/page.tsx` — the pager page inside Crew. **Evidence:** route
  `/apps/bipeur` renders a real composed line.
- [ ] 7. End-to-end: a Crew approval resolved from the pager.
  **Evidence:** audit events `page.created` … `page.decided` with one fingerprint.

## Traceability

| Requirement | Tasks |
|---|---|
| BIP-F-27 | 2, 3, 4, 5, 7 |
| BIP-N-02 | 5 |
