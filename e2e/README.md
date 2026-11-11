# E2E — the seven scenarios of A.5, replayed for real

These are **not** mocked. Each scenario starts a real Central (its own SQLite
file, its own port), serves the real pager build from it, opens a real Chromium,
pairs a real ECDSA P-256 device key, and asserts on what the Central actually
stored.

```bash
pnpm --filter @bipeur/e2e exec playwright install chromium   # once
pnpm e2e                                                     # the whole suite (~2 min)
pnpm --filter @bipeur/e2e exec playwright test p2-approve    # one scenario
pnpm --filter @bipeur/e2e exec playwright show-report        # the HTML report
```

The suite runs on `main` and on demand (`.github/workflows/e2e.yml`), never on a
pull request: a PR verdict must stay inside five minutes.

## What each scenario proves

| Scenario | Proves | Requirement |
|---|---|---|
| `p1-pairing` | The Central issues a six-character code and a QR link, the pager registers a non-extractable key and receives a device token, the Central counts one paired pager, the link is single use, a wrong code pairs nothing | BIP-F-15 |
| `p2-approve` | A `git push` becomes `310 main PUSH main>origin 3 commits +120-14 #5c42`, the pager shows exactly that line, one tap on ✔ signs it, the source receives `approved` with the same fingerprint, and the audit log carries `page.decided`. A decision on **another** fingerprint is refused with `fingerprint_mismatch` and logged as `decision.rejected` | BIP-F-01, 02, 18 · A.17 |
| `p3-deny-destructive` | A `rm -rf` page is red, a quick tap does nothing, one second of press-and-hold refuses it, and the source receives the refusal **with its reason** | BIP-F-17 · A.5 P3 |
| `p4-question` | A question arrives with seeded replies A/B/C, the three keys appear, tapping B sends `choice: "B"` to the source, and a choice outside the seeded replies is refused | BIP-F-17, 18 · A.5 P4 |
| `p5-expiry` | Nobody answers: the page expires, the source receives a refusal by default with the reason `no human decision`, the audit log has `page.expired` with `default: deny`, and **no** `page.decided` exists for it | BIP-F-07 · A.5 P5 · A.17 |
| `p6-budget` | Seven requests in a minute give six deliveries and one held page; a red page goes through even when the budget is full | BIP-F-09 · BIP-P-07, 08 |
| `p7-demo` | `POST /v1/demo/start` opens an isolated visitor space with its own station and device tokens, the simulator plays its script (`fw`, `a`, `b`: a push, a destructive `rm`, three questions), the space is wiped after 24 h, and it stays isolated from the other posts | BIP-F-31 · A.5 P7 |

## Helpers

| File | Role |
|---|---|
| `scripts/central-server.mjs` | Builds and starts a Central: fresh SQLite file, fixed station token, demo mode on, loopback only. Always rebuilds — a stale `dist/` silently tests the previous code |
| `helpers/server.ts` | `startDedicatedCentral(port)` for the scenarios that need a fresh budget or clock |
| `helpers/central.ts` | Typed client of the real API: creates pages as a station, pairs a device, **signs a decision with a real ECDSA P-256 key** exactly like the pager does, reads the audit log |
| `helpers/pager.ts` | Opens the pager, and bridges only what a browser cannot do in a test (the pairing handshake and the decision relay). The WebSocket is **not** mocked: pages arrive through the real stream |
| `helpers/line.ts` | The assertions on the 80-character line: length, printable ASCII, the `#hhhh` tag, and the tag matching the fingerprint of the payload |
| `helpers/flows.ts` | `pairPager()` — the flow a human follows: read the code, type it, see "1 device paired" and the connection go online |

## Rules these tests follow

- **No sleeping to prove a timeout.** P5 uses the shortest TTL the contract
  allows (30 s) and a bounded poll; the expiry itself is driven by the Central.
- **No sound, no notification, no external network, no real terminal.** The
  Web Push path is not exercised here: it is behind an interface and covered by
  the Central's unit tests.
- **Deterministic.** One worker, no retries, fixed ports per scenario, a fresh
  database per Central.
