# Threat model

Eight threats, one page. Each row says what the attack is, what stops it, and
**where the stopping happens** — a parade that cannot be pointed at in the code
is a wish. Requirement ids are the ones of the specification (A.7, A.10).

| # | Threat | Parade | Implemented in | Verified by |
|---|---|---|---|---|
| 1 | **A lying agent.** The agent describes a harmless action to get a dangerous one approved. | The line and detail screens 2–3 are composed by the Central **from the payload alone** (command, path, cwd, branch, diff stats). The agent's prose goes to screen 4, prefixed `AGENT SAYS:`, and nowhere else. | `packages/core/src/line.ts` — `composeLine` takes facts only, `buildDetailScreens` is the single consumer of `agent_says` (BIP-F-02) | `tools/pentest/run.mjs` threat 1: `agent_says="safe ls"` + `command="rm -rf /"` — the line shows the command, the prose lands on screen 4 labelled, the risk stays red |
| 2 | **Replay or redirection of an approval.** An approval is re-sent, or applied to another request. | The decision is signed over `{page_id, fingerprint, verdict, choice, nonce, expires_at, device_id}`. The Central verifies signature, device, fingerprint equality, deadline and nonce freshness; the hook re-checks the fingerprint before exiting `0`. | `packages/core/src/decision.ts` (`decisionSigningString`), `packages/core/src/node.ts` (`verifyDecision`), `nonces` table, `packages/hook/src/decide.ts` (BIP-F-18, BIP-P-05, BIP-P-06) | `tools/pentest/run.mjs` threat 2: replayed signature (409 `replayed_nonce`), signature posted on another page (422), wrong key, `device_id` mismatch, past deadline, truncated signature — every refusal writes `decision.rejected`; plus E2E P2 and `decide.props.test.ts` |
| 3 | **Page flooding.** A third party sends fake pages to exhaust the human. | One token per station, stored hashed; per-station rate limit; attention budget of six pages per hour enforced **server-side**; one-gesture revocation of a station or a device. | `hashToken` (`core/node.ts`), `AttentionBudget` (`core/budget.ts`), `sources.token_hash`, `device.revoked` event (BIP-N-03, BIP-F-09) | `tools/pentest/run.mjs` threat 3: budget holds the 7th page, 300 creations hit 429 at #241, 1500 forged tokens all get 401 — **but see “Open weaknesses” below: two rate-limit keys are client-controlled** |
| 4 | **A stolen or lent phone.** Someone else holds the device. | Red pages need the app open **and** a one-second press-and-hold; a device can be revoked from the Central in one gesture; the OS biometric lock is available on top. | `packages/pager/src/pager/HoldToConfirm.tsx`, `POST /v1/devices/{id}/revoke` (BIP-F-17) | `tools/pentest/run.mjs`: a revoked device is refused (403) for decisions and for resync; the press-and-hold itself is pager-side, proven by E2E P3 |
| 5 | **Leak on the lock screen.** The page content is readable by whoever walks past. | Masking setting: only the code and the station appear in the notification; the detail stays inside the app. | `devices.mask_on_lock_screen`, push payload built in `packages/central/src/push/` (BIP-N-04) | PARTIAL — the bench proves the Central opens no push channel without a subscription (nothing content-bearing leaves the server); the masking itself lives in the pager app and is not reachable from a server-side bench |
| 6 | **Prompt injection through page content.** The page text tries to manipulate the human, or another agent reading the log. | Page content is **data**: printable ASCII only, no markup, no clickable link except the `callback_url` the station declared and the server validated as `http(s)`. | `toLineText` (`core/ascii.ts`), `schema.ts` `urlish`, dashboard renders text nodes (BIP-N-03) | `tools/pentest/run.mjs` threat 6: fake `AGENT SAYS:` label, fake `#abcd` tag, markdown, URL and accents stay inert printable ASCII behind the real fingerprint tag; CR/bell/ESC in a question are refused (422) and stripped from commands; `javascript:` callback refused (422); 500 audit events scanned clean of every forbidden payload key |
| 7 | **The Central is down.** No decision can be obtained. | Fail closed: the hook refuses the tool with an explicit reason and writes an audit event. A page that expires is a refusal, never an approval. | `packages/hook/src/bin.ts` (every error path exits `2`), `on_expire: deny` in `.bipeur/rules.yaml` (BIP-F-07) | `tools/pentest/run.mjs` threat 7 (exit 2 against a dead port) and `packages/central/test/chaos-downtime.test.ts`: the Central killed **during** the long poll still yields exit 2, never 0; corrupted, truncated or read-only SQLite refuses to boot or answers 500 — never a false state, never an approval |
| 8 | **The SNPP gateway is reachable from outside.** RFC 1861 is plaintext, no TLS. | Loopback bind by default (`127.0.0.1:4440`); `LOGIn` required outside the loopback; the historical privileged port 444 is never used. | `packages/snpp/src/bin.ts`, `.kiro/steering/rfc1861.md` (BIP-F-28) | `tools/pentest/run.mjs` threat 8: booting on `0.0.0.0` without `LOGIn` exits 2; a pre-login command gets `421` + hangup; binary junk, 10 000-char lines, foreign `MSTA` tags, unknown verbs and 200 fuzzed binary lines all get an RFC code with the gateway still standing (BIP-P-11 attacked, not read) |

## Open weaknesses (found by the pentest bench, 2026-11-11)

Found by `tools/pentest/run.mjs` on a local instance. They are **documented,
not fixed**, on this branch: the application code belongs to other work
branches, and a documented weakness beats a conflicting fix. Each entry names
the file to change.

| # | Weakness | Measured evidence | Mitigation available today | Where to fix |
|---|---|---|---|---|
| W1 | **`X-Forwarded-For` is the rate-limit key of `POST /v1/demo/start`.** Any caller spoofs the header and creates unlimited demo spaces — each one a visitor, a source, a device and a synchronous ECDSA keypair: memory, disk and CPU exhaustion of a public demo instance. | 60 demo starts in one minute, 60× `201`, against a declared limit of 20/min (`run.mjs`, threat 3) | Put a proxy in front that overwrites `X-Forwarded-For`, or disable demo mode (`BIPEUR_DEMO=0`) | `packages/central/src/routes/demo.ts` — key on the socket address; trust XFF only behind a declared proxy |
| W2 | **The pairing limiter of `POST /v1/devices` has the same flaw** (`bearer ?? x-forwarded-for ?? 'local'`): pairing-code guessing is not actually rate limited, and each attempt allocates a limiter entry. | 40 pairing attempts with rotating XFF: 40 refusals, **0** `429` (limit 20/min) | Same proxy mitigation | `packages/central/src/routes/devices.ts` — key on the socket address; count failures per pairing code |
| W3 | **`RateLimiter.hits` grows without bound.** Every request carrying a fresh forged token allocates a permanent `Map` entry before authentication: unauthenticated memory exhaustion at scale. | 1500 forged tokens → RSS +3.0 MiB (~2.9 KiB/token, never evicted) ≈ 1 GB per ~350 k requests | A reverse proxy with a connection rate limit | `packages/central/src/rate-limit.ts` — cap the map, evict globally, or track only known token hashes |
| W4 | **A station declares its own `code`: family 9 bypasses everything.** `code: 911` on a trivial question walks through the attention budget and quiet hours — by design for real incidents (BIP-P-08), but the code is source-declared, so a stolen token or a compromised agent pages the human without limit. Declared `risk: "green"` and incoherent verbs, on the other hand, are correctly ignored (risk never goes down). | 10/10 `code:911` pages delivered with a full budget (`run.mjs`, threat 3) | Revoke the station in one gesture (`DELETE /v1/sources` / device revocation); keep station tokens secret | `packages/central/src/compose.ts` — allow-list stations permitted to emit family 9, or cap family-9 pages per station per hour |
| W5 | **The device token travels in the WebSocket query string** (`GET /v1/stream?token=…`). The Central itself never logs request URLs (verified: no token in any captured log line), but any reverse proxy, CDN or access log in front of it would capture a live credential. | `packages/central/test/chaos-stream.test.ts` — invalid token refused with 401 on upgrade; valid token accepted; log scan clean | Terminate the socket at the proxy, or strip query strings from access logs | `packages/central/src/stream.ts` — accept the token on the first authenticated frame instead of the URL |
| W6 | **Signature encoding malleability (informational).** The same ECDSA signature is accepted as base64 **and** base64url. Replay is still blocked by the nonce, so this is not exploitable today, but two wire forms of one signature weaken auditability. | both encodings accepted on two distinct pages (`run.mjs`, threat 2) | none needed | `packages/core/src/node.ts` (`toBase64`) — pick one canonical encoding |

### Verdicts of the bench run (2026-11-11, commit `abba6d5` + this branch)

25 attacks: 20 defences held, 2 FAILED (W1, W2), 3 WEAK (W3, W4, W6),
1 PARTIAL (threat 5, pager-side). Replay the table with:

```
pnpm build && node tools/pentest/run.mjs
```

The bench exits non-zero while W1/W2 stand: a red table is an honest table.

## Threats we explicitly do not answer

- **A compromised workstation.** If an attacker runs code on the machine that
  hosts the Central or the agent, they can read the SQLite file. Self-hosting
  means the machine is the perimeter; we say so instead of pretending otherwise.
- **A malicious Kiro build.** Beeper complements Kiro's permission system, it
  does not replace it. The security boundary stays where it is.
- **Traffic analysis on a shared network.** TLS is out of scope of the loopback
  and documented as such; the product is not sold as a way to hide metadata.
- **An obfuscated command that fools the rules.** The classification sorts
  attention; it is not a sandbox. Anything unrecognised pages **amber**, never
  passes silently — and the documentation says it plainly.

## Two properties that are asserted, not promised

| Property | What it means here |
|---|---|
| BIP-P-05 | A decision whose fingerprint differs from the page's is never accepted. Tested with fast-check over generated claim/payload pairs. |
| BIP-P-04 | A page receives at most one accepted decision, however many arrive concurrently — `UNIQUE(page_id)` plus an in-process guard, tested with concurrent submissions. |

The audit log carries the fingerprint, the station, the device, the state and the
latency. It never carries the payload: a leaked log file must not be a leaked
command history (BIP-N-03).
