# snpp-gateway — tasks

Lot A6, optional, and the first of the options (A.14): it is the lot that makes
"Resurrection" literal.

- [ ] 1. `src/codes.ts` — reply-code constants copied from the RFC table, with
  the RFC section as a comment. **Evidence:** no code used anywhere that is not
  declared here.
- [ ] 2. `src/parser.ts` — four-letter prefix match, case-insensitive, arguments
  split on the first space, 512-byte cap. **Evidence:** BIP-P-11 green.
- [ ] 3. `src/states.ts` — the transition table and `canAccept`.
  **Evidence:** out-of-sequence matrix test, all `503` (BIP-F-28).
- [ ] 4. `src/session.ts` — per-socket state, tag store, cleanup on close.
  **Evidence:** a closed socket releases its tags.
- [ ] 5. `src/handlers.ts` — one handler per command, mapped onto the Central.
  **Evidence:** `SEND` → `POST /v1/pages`, `861 <tag> <secret>` returned.
- [ ] 6. `MSTAtus` mapping. **Evidence:** `861`, `870`, `888` and `780` each
  reachable from a page state (BIP-F-28).
- [ ] 7. `src/bin.ts` — bind `127.0.0.1:4440`, `LOGIn` outside the loopback,
  `HELP`. **Evidence:** `nc 127.0.0.1 4440` answers `220 SNPP (V3) Gateway Ready`.
- [ ] 8. Transcript replay test from `docs/SNPP.md`. **Evidence:** the exact
  bytes of the documented session, in an in-process TCP pair.
- [ ] 9. Refusal of an unknown command and of a malformed line.
  **Evidence:** `501`, never a crash (BIP-P-11).

## Traceability

| Requirement | Tasks |
|---|---|
| BIP-F-28 | 1, 3, 5, 6, 7, 8 |
| BIP-P-11 | 2, 9 |
| BIP-N-03 | 7 |
