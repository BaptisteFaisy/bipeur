# Beeper — Kiro Crew app

A Crew app is a package described by an `app.json` manifest that brings pages,
background processes, agents and MCP servers. This one brings the pager into the
Crew dashboard (BIP-F-27, lot A7): approval events become Beeper pages, and the
human's signed decision becomes an approval resolution.

```
app.json           the manifest: one page, one background process, two paths
src/index.ts       relay(config, client) and the public exports
src/relay.ts       Gateway events -> pages and notices, bounded queue, retries
src/resolve.ts     decision -> POST <CREW_APPROVAL_PATH> {approval_id, decision, reason}
src/gateway.ts     CrewGateway interface + WebSocket transport with bounded backoff
src/events.ts      the event contract (approval, task_complete, notification)
src/beeper.ts      the Beeper Central client (shared zod schemas of @bipeur/core)
src/page/          the dashboard page: pending approvals + the pager screen
```

## To verify — read this before trusting the paths

The contest specification (A.9) explicitly marks two things **"to verify"** in the
Crew API reference: **the exact REST paths of the Gateway** and **the shape of the
`approval` event**. No client library exists for the Gateway, so the process calls
the REST and WebSocket endpoints directly.

Consequences in this code:

- the paths are **never hard-coded in the logic**: they are read from
  `CREW_GATEWAY_URL`, `CREW_APPROVAL_PATH` and `CREW_NOTIFICATION_PATH`
  (`src/config.ts`); the defaults in `DEFAULTS` are documented placeholders,
  repeated in `app.json` under `config`;
- the event parser (`src/events.ts`) is lenient: unknown events are ignored, an
  `{payload: …}` or `{data: …}` envelope is unwrapped, `id` is accepted for
  `approval_id` and `line` for `message`. A wrong shape degrades to "event
  ignored", never to a crash or a false beep.

The only hard-coded values left are the Crew-side semantics the app owns:
`tool_name: 'crew.approval'` and the dedupe key `crew:approval:<approval_id>`.

## Event contract

| Event | Fields used | Effect |
|---|---|---|
| `approval` | `approval_id`, `summary`, `tool_name`, `command`, `path` | creates a `tool` page, `tool_name: 'crew.approval'`, `dedupe_key: crew:approval:<id>`, the Crew summary goes to `agent_says` (screen 4 only — the honesty rule) |
| `task_complete` | `task_id`, `summary` | `POST /v1/notices`, `CREW DONE <summary>` — no page, no beep |
| `notification` | `message`, `level` | `POST /v1/notices`, `CREW NOTIFY <message>` — no page, no beep |

## Decision mapping

| Page decision | Resolution |
|---|---|
| `approved` | `approve`, reason `approved from the pager` |
| `choice X` | `approve`, reason `choice X from the pager` |
| `denied` | `deny`, the human's reason |
| `cancelled` | `deny`, reason `page cancelled` |
| `expired` / `pending` | `deny`, reason `no decision before expiry` — fail closed |

The resolution is `POST <CREW_APPROVAL_PATH>` with
`{"approval_id": "…", "decision": "approve" | "deny", "reason": "…"}`. A failure
is retried three times with a backoff, then written to the journal of record as
`CREW RESOLVE FAILED <approval_id> after 3 tries`: a lost resolution is never
silent.

## Configuration

| Variable | Default | Role |
|---|---|---|
| `CREW_GATEWAY_URL` | `ws://127.0.0.1:8790` | Gateway base, `ws(s)://` or `http(s)://` (to verify) |
| `CREW_APPROVAL_PATH` | `/api/crew/approvals/resolve` | approval resolution path (to verify) |
| `CREW_NOTIFICATION_PATH` | `/api/crew/notifications` | notification path (to verify) |
| `BIPEUR_URL` | `http://127.0.0.1:8787` | Beeper Central |
| `BIPEUR_TOKEN` | — | station token, required, never logged |
| `BIPEUR_STATION` | `crew` | station alias on the page line |
| `CREW_PAGE_TTL` | `900` | page lifetime, seconds |
| `CREW_QUEUE_LIMIT` | `200` | bound of the local event queue |
| `CREW_BACKOFF_MS` / `CREW_MAX_BACKOFF_MS` | `500` / `30000` | bounded exponential backoff |
| `CREW_RESOLVE_ATTEMPTS` | `3` | attempts before the explicit notice |
| `CREW_WAIT_SECONDS` | `50` | ceiling of one decision long-poll |

## Reliability

- **Reconnection**: bounded exponential backoff, capped at `CREW_MAX_BACKOFF_MS`,
  state kept in the relay, so a Gateway restart does not duplicate a page.
- **No lost event on a cut**: a bounded local queue (`CREW_QUEUE_LIMIT`) holds
  events while the Central or the Gateway is away; past the bound the oldest is
  dropped **and counted in the log**, never silently.
- **Idempotence**: one `approval_id` gives one page (Central dedupe key) and one
  resolution; a re-emitted approval after a failed resolution retries the
  resolution, not the page.
- **Fail closed**: an expired page or an unreachable Central resolves to `deny`.
- **No sound**, and no token or payload in the logs.

## The page

`src/page/index.html` + `src/page/page.js`, no dependency: it renders the pager
screen (4 rows × 20 columns) and the approvals still waiting, inside the Crew
dashboard. It is **read-only**: a decision must be signed by the paired pager,
never taken from a dashboard tab. Its feed URL (`/v1/pages?state=queued`) is a
placeholder too — see the "To verify" section.

## Tests

`pnpm test` (no network, no WebSocket, no timer):

- an `approval` event creates one page with `dedupe_key: crew:approval:<id>`, and
  a second emission of the same id creates nothing;
- an approved decision calls the resolution once;
- a failing resolution is attempted three times, then a notice names the approval;
- a `notification` and a `task_complete` post a notice and never page.
