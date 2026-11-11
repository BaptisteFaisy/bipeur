# Threat model

Eight threats, one page. Each row says what the attack is, what stops it, and
**where the stopping happens** — a parade that cannot be pointed at in the code
is a wish. Requirement ids are the ones of the specification (A.7, A.10).

| # | Threat | Parade | Implemented in |
|---|---|---|---|
| 1 | **A lying agent.** The agent describes a harmless action to get a dangerous one approved. | The line and detail screens 2–3 are composed by the Central **from the payload alone** (command, path, cwd, branch, diff stats). The agent's prose goes to screen 4, prefixed `AGENT SAYS:`, and nowhere else. | `packages/core/src/line.ts` — `composeLine` takes facts only, `buildDetailScreens` is the single consumer of `agent_says` (BIP-F-02) |
| 2 | **Replay or redirection of an approval.** An approval is re-sent, or applied to another request. | The decision is signed over `{page_id, fingerprint, verdict, choice, nonce, expires_at, device_id}`. The Central verifies signature, device, fingerprint equality, deadline and nonce freshness; the hook re-checks the fingerprint before exiting `0`. | `packages/core/src/decision.ts` (`decisionSigningString`), `packages/core/src/node.ts` (`verifyDecision`), `nonces` table, `packages/hook/src/decide.ts` (BIP-F-18, BIP-P-05, BIP-P-06) |
| 3 | **Page flooding.** A third party sends fake pages to exhaust the human. | One token per station, stored hashed; per-station rate limit; attention budget of six pages per hour enforced **server-side**; one-gesture revocation of a station or a device. | `hashToken` (`core/node.ts`), `AttentionBudget` (`core/budget.ts`), `sources.token_hash`, `device.revoked` event (BIP-N-03, BIP-F-09) |
| 4 | **A stolen or lent phone.** Someone else holds the device. | Red pages need the app open **and** a one-second press-and-hold; a device can be revoked from the Central in one gesture; the OS biometric lock is available on top. | `packages/pager/src/pager/HoldToConfirm.tsx`, `POST /v1/devices/{id}/revoke` (BIP-F-17) |
| 5 | **Leak on the lock screen.** The page content is readable by whoever walks past. | Masking setting: only the code and the station appear in the notification; the detail stays inside the app. | `devices.mask_on_lock_screen`, push payload built in `packages/central/src/push/` (BIP-N-04) |
| 6 | **Prompt injection through page content.** The page text tries to manipulate the human, or another agent reading the log. | Page content is **data**: printable ASCII only, no markup, no clickable link except the `callback_url` the station declared and the server validated as `http(s)`. | `toLineText` (`core/ascii.ts`), `schema.ts` `urlish`, dashboard renders text nodes (BIP-N-03) |
| 7 | **The Central is down.** No decision can be obtained. | Fail closed: the hook refuses the tool with an explicit reason and writes an audit event. A page that expires is a refusal, never an approval. | `packages/hook/src/bin.ts` (every error path exits `2`), `on_expire: deny` in `.bipeur/rules.yaml` (BIP-F-07) |
| 8 | **The SNPP gateway is reachable from outside.** RFC 1861 is plaintext, no TLS. | Loopback bind by default (`127.0.0.1:4440`); `LOGIn` required outside the loopback; the historical privileged port 444 is never used. | `packages/snpp/src/bin.ts`, `.kiro/steering/rfc1861.md` (BIP-F-28) |

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
