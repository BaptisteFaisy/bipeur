# E2E — the seven scenarios of A.5, replayed for real

These are **not** mocked. Each scenario starts a real Central (its own SQLite
file, its own port), serves the real pager build from it, opens a real Chromium,
pairs a real ECDSA P-256 device key, and asserts on what the Central actually
stored.

```bash
pnpm --filter @bipeur/e2e exec playwright install chromium   # once
pnpm e2e                                                     # the whole suite, both groups
pnpm --filter @bipeur/e2e exec playwright test --project group-a   # P1…P4 + P7
pnpm --filter @bipeur/e2e exec playwright test --project group-b   # P5…P6
pnpm --filter @bipeur/e2e exec playwright test p2-approve    # one scenario
pnpm --filter @bipeur/e2e exec playwright show-report e2e/playwright-report/base-9200
```

The suite runs on `main` and on demand (`.github/workflows/e2e.yml`), never on a
pull request: a PR verdict must stay inside five minutes. In CI the two groups
play **in parallel, in two jobs of their own**: the whole suite in a single job
passed the five-minute budget on a loaded machine and was killed. Each job sets
its own `BIPEUR_E2E_PORT_BASE` (9200 for `group-a`, 9300 for `group-b`).

## Two groups, one base of ports

| Group | Scenarios | Why here |
|---|---|---|
| `group-a` | P1, P2, P3, P4, P7 | The browser-heavy half — five scenarios drive a real Chromium (pairing, approve, hold-to-refuse, choice, demo) — plus P7's simulator, which plays one page every four seconds (~22 s of bounded poll) |
| `group-b` | P5, P6 | The half anchored on P5: it holds a real 30 s TTL — the shortest the contract allows, the only incompressible wait of the suite — and P6 exercises the budget on dedicated Centrals, without a browser |

The two real waits of the suite (P5's TTL, P7's simulator) sit in **opposite**
halves: measured side by side, P1…P4 weigh ~10 s of scenarios against ~56 s for
P5…P7, while this split gives ~34 s against ~36 s — two jobs of about one
minute each, both far inside the five-minute budget even on a loaded runner.

Every port derives from `BIPEUR_E2E_PORT_BASE` (default 9200) plus a fixed
offset per scenario, declared once in `helpers/ports.ts` — no port number is
written anywhere else. The base stays clear of the other loopback services of
the host: 8787 (another project) and 8790–8810 (development Centrals). Two
parallel runs with different bases share nothing: distinct ports, distinct
`.runtime/base-<base>` directories, distinct SQLite files, distinct report and
trace folders.

## What each scenario proves

| Group | Scenario | Proves | Requirement |
|---|---|---|---|
| a | `p1-pairing` | The Central issues a six-character code and a QR link, the pager registers a non-extractable key and receives a device token, the Central counts one paired pager, the link is single use, a wrong code pairs nothing | BIP-F-15 |
| a | `p2-approve` | A `git push` becomes `310 main PUSH main>origin 3 commits +120-14 #5c42`, the pager shows exactly that line, one tap on ✔ signs it, the source receives `approved` with the same fingerprint, and the audit log carries `page.decided`. A decision on **another** fingerprint is refused with `fingerprint_mismatch` and logged as `decision.rejected` | BIP-F-01, 02, 18 · A.17 |
| a | `p3-deny-destructive` | A `rm -rf` page is red, a quick tap does nothing, one second of press-and-hold refuses it, and the source receives the refusal **with its reason** | BIP-F-17 · A.5 P3 |
| a | `p4-question` | A question arrives with seeded replies A/B/C, the three keys appear, tapping B sends `choice: "B"` to the source, and a choice outside the seeded replies is refused | BIP-F-17, 18 · A.5 P4 |
| b | `p5-expiry` | Nobody answers: the page expires, the source receives a refusal by default with the reason `no human decision`, the audit log has `page.expired` with `default: deny`, and **no** `page.decided` exists for it | BIP-F-07 · A.5 P5 · A.17 |
| b | `p6-budget` | Seven requests in a minute give six deliveries and one held page; a red page goes through even when the budget is full | BIP-F-09 · BIP-P-07, 08 |
| a | `p7-demo` | `POST /v1/demo/start` opens an isolated visitor space with its own station and device tokens, the simulator plays its script (`fw`, `a`, `b`: a push, a destructive `rm`, three questions), the space is wiped after 24 h, and it stays isolated from the other posts | BIP-F-31 · A.5 P7 |

## Helpers

| File | Role |
|---|---|
| `scripts/central-server.mjs` | Builds and starts a Central: fresh SQLite file, fixed station token, demo mode on, loopback only. Always rebuilds — a stale `dist/` silently tests the previous code |
| `helpers/ports.ts` | The single source of every port: `BIPEUR_E2E_PORT_BASE` plus a fixed offset per scenario, and the per-base runtime, report and trace directories |
| `helpers/server.ts` | `startDedicatedCentral(role)` for the scenarios that need a fresh budget or clock. It reuses the build the run's launcher just made (`BIPEUR_E2E_SKIP_BUILD=1`): rebuilding per scenario made the health window tight on a loaded runner |
| `helpers/central.ts` | Typed client of the real API: creates pages as a station, pairs a device, **signs a decision with a real ECDSA P-256 key** exactly like the pager does, reads the audit log |
| `helpers/pager.ts` | Opens the pager, and bridges only what a browser cannot do in a test (the pairing handshake and the decision relay). The WebSocket is **not** mocked: pages arrive through the real stream |
| `helpers/line.ts` | The assertions on the 80-character line: length, printable ASCII, the `#hhhh` tag, and the tag matching the fingerprint of the payload |
| `helpers/flows.ts` | `pairPager()` — the flow a human follows: read the code, type it, see "1 device paired" and the connection go online |

## Rules these tests follow

- **No sleeping to prove a timeout.** P5 uses the shortest TTL the contract
  allows (30 s) and a bounded poll; the expiry itself is driven by the Central.
  It is the only real wait of the suite, and it lives in one group only.
- **No sound, no notification, no external network, no real terminal.** The
  Web Push path is not exercised here: it is behind an interface and covered by
  the Central's unit tests.
- **Deterministic.** One worker, no retries, every port derived from one base
  per run, a fresh database per Central.
