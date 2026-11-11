# kiro-adapters — tasks

Lot A3. Order: rules first (both adapters share them), then the hook, then the
notice, then MCP.

- [ ] 1. `src/rules.ts` — load `.bipeur/rules.yaml`, validate with the core
  schema, expose `classify()`. **Evidence:** a bad YAML fails with a readable
  error, a good one classifies `git push` as `page(310, amber)`.
- [ ] 2. `src/output.ts` — the exact strings and exit codes. **Evidence:** unit
  test per outcome.
- [ ] 3. `src/decide.ts` — create the page, long poll, verify the fingerprint,
  map the decision to an exit code. **Evidence:** test double for the Central,
  five outcomes covered (BIP-F-24).
- [ ] 4. `src/bin.ts` — stdin read, `--rules` flag, fail-closed on any error.
  **Evidence:** exit `2` when `BIPEUR_URL` is unreachable.
- [ ] 5. Fast path measurement. **Evidence:** a timing test asserting the
  `allow` path stays under 50 ms (BIP-N-01).
- [ ] 6. `src/notice.ts` — `bip-notice`, always exit `0`.
  **Evidence:** notice posted with the Central down still exits `0` (BIP-F-25).
- [ ] 7. `packages/mcp-server/src/tools.ts` — the three tools and their schemas.
  **Evidence:** schema test, 81-character question refused (BIP-F-26).
- [ ] 8. `page_human` 50-second cap. **Evidence:** fake clock test returns
  `pending` at 50 s with the page id.
- [ ] 9. `src/bin.ts` of the MCP server — stdio transport, `npx bipeur-mcp`.
  **Evidence:** `npx bipeur-mcp` answers `initialize` and `tools/list`.
- [ ] 10. End-to-end proof with a real Kiro session. **Evidence:** the three
  audit events with one fingerprint + the agent log showing the resumption.

## Traceability

| Requirement | Tasks |
|---|---|
| BIP-F-24 | 1, 2, 3, 4, 10 |
| BIP-F-25 | 6 |
| BIP-F-26 | 7, 8, 9 |
| BIP-N-01 | 5 |
| BIP-N-02 | 3 |
