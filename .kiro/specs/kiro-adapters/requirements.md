# kiro-adapters — requirements

- **Route:** requirements first (A.13). The contract with Kiro is fixed by Kiro
  itself (hook event shape, exit codes, MCP transport); it is written down before
  the code so the adapter cannot invent its own protocol.
- **Covers:** BIP-F-24, BIP-F-25, BIP-F-26. Lot A3.
- **Packages:** `packages/hook` (`bip-hook`, `bip-notice`), `packages/mcp-server`
  (`bipeur-mcp`).

## BIP-F-24 (I) — Kiro hook

WHEN Kiro is about to use a tool covered by the hook, THE `bip-hook` SCRIPT SHALL
read the event on its standard input, apply the local rules first (allow or deny
without paging), and otherwise create a page and wait. It SHALL exit with code
`0` when the decision is an approval, and with code `2` and the reason on
standard error otherwise.

- Accept: exit `0` on approve; exit `2` with a one-line reason on deny, on
  expiry, on a rejected decision and when the Central is unreachable.
- Accept: the local `allow` list answers in under 50 ms and creates no page
  (BIP-N-01).
- Accept: the event shape read is
  `{hook_event_name, cwd, session_id, tool_name, tool_input}`.
- Accept: the hook re-checks the fingerprint of the decision against the request
  before exiting `0`.

### Refinement: what the hook may not do

- It SHALL NOT lower a risk computed by the rules.
- It SHALL NOT print the payload to its logs; the fingerprint is enough.
- It SHALL NOT retry a refusal: a refusal is a decision.

## BIP-F-25 (S) — End of turn

WHEN an agent finishes its turn, THE END-OF-TURN HOOK (`bip-notice`) SHALL send a
notice to the digest, without blocking.

- Accept: a notice is one line of at most 80 printable ASCII characters.
- Accept: the hook exits `0` even if the Central is down — a notice never blocks
  work.

## BIP-F-26 (I) — MCP server

THE `bipeur` MCP SERVER SHALL expose `page_human`, `page_wait` and
`page_cancel`. `page_human` SHALL wait at most 50 seconds, then return `pending`
and the identifier, so it never exceeds the MCP client timeout.

- Accept: `page_human` returns
  `{status: approved|denied|choice|expired|pending, choice, page_id, latency_ms}`.
- Accept: `question` is at most 80 characters (`maxLength: 80` in the schema);
  `options` is 2 to 4 entries with codes `A`–`D` and labels of 20 characters max.
- Accept: `ttl_seconds` is between 30 and 86400.
- Accept: transport is stdio by default (`npx bipeur-mcp`), HTTP optional.

## Non-functional

| Id | Requirement |
|---|---|
| BIP-N-01 | The local-rule fast path of the hook adds under 50 ms. |
| BIP-N-02 | A hook reconnecting with the same idempotency key finds its page. |
| BIP-N-03 | No payload in the hook logs; the station token comes from `BIPEUR_TOKEN`. |
| Fail closed | Without a decision, the tool is refused with a clear reason. |

## Out of scope

The Central API (spec `central-core`), the SNPP gateway (spec `snpp-gateway`),
the Crew app (spec `crew-app`).
