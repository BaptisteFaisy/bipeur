# Beeper — Kiro Crew app

A Crew app is a package described by an `app.json` manifest that brings pages,
background processes, agents and MCP servers. This one brings the pager into the
Crew dashboard (BIP-F-27, lot A7): approval events become Beeper pages, and the
human's signed decision becomes an approval resolution.

The wire contract is **established, not guessed**: every path, header and event
shape comes from the official docs and from the Gateway's own source
(`github.com/kirodotdev/KiroCrew`). Read [`docs/CREW.md`](../../docs/CREW.md)
for the fact table, the sources, and the short list of things only a real Crew
can confirm.

```
app.json           the manifest: one dashboard page, one node backend, minimal permissions
src/index.ts       relay(config, client) and the public exports
src/auth.ts        app secret -> token exchange -> mc_token_<port> cookie, rotation on 401/403
src/config.ts      the real Gateway paths, with env overrides for tests and odd deployments
src/relay.ts       Gateway frames -> pages and notices, bounded queue, bounded retries
src/resolve.ts     decision -> POST /api/chat/slots/{slot}/approve (native form carries the reason)
src/gateway.ts     CrewGateway interface + /api/ws transport with bounded backoff and cookie auth
src/events.ts      the frame contract: approval, approval_resolved, notification, task_*
src/beeper.ts      the Beeper Central client (shared zod schemas of @bipeur/core)
ui/page.mjs        the dashboard page: host-mounted ESM, bare imports resolved by the host
```

## Authentication

The relay is a standalone backend process. The Gateway hands launched backends
their secret in `KIROCREW_PROXY_SECRET` (beside `KIROCREW_APP_NAME`); older
Gateways keep it in `~/.kiro/crew/apps/bipeur/.app_secret`. The secret is
exchanged for a short-lived token (`POST /api/apps/bipeur/token`, header
`X-App-Secret`), carried as the `mc_token_<port>` cookie on every request and
on the WebSocket handshake, and re-exchanged once on a 401/403. Neither the
secret nor the token is ever logged, and `CREW_APP_SECRET` exists for tests
only.

## Frame contract (over `/api/ws`)

Every frame is `{"type": <event>, "data": {...}}`.

| Event | Fields used | Effect |
|---|---|---|
| `approval` | `id`, `instance`, `slot`, `tool`, `tool_input`, `tool_purpose` | creates a `tool` page, `dedupe_key: crew:approval:<id>:<instance>`, purpose goes to `agent_says` (screen 4 only — the honesty rule) |
| `approval_resolved` | `id` | the request was decided elsewhere: never page for it again |
| `notification` | `title`/`body` | journal notice `CREW NOTIFY …` — no page, no beep |
| `task_complete` / `task_update` | `summary`/`task_id` | journal notice `CREW DONE …` — no page, no beep (listed by the SDK docs; no Gateway emitter found in the open-source tree, handled leniently) |

Unknown frames are ignored; a wrong shape never crashes and never beeps.

## Decision mapping

| Page decision | Resolution on the Gateway |
|---|---|
| `approved` / `choice X` | slot decide `{action:"approved", request_id, response_id}` |
| `denied` (with reason) | **native decide** `{origin:"native", request_id, request_mid:<instance>, action:"rejected", reason, response_id}` — the only form the Gateway admits a reason on; a 400 falls back to the plain reason-less denial |
| `cancelled` / `expired` / `pending` | denial, fail closed (BIP-F-07) — never an approval |

`response_id` is stable per (request, decision), so a retry replays the same
Gateway outcome instead of resolving twice. A frame without `slot` falls back
to the global route `POST /api/approvals/{id}/{approve|reject}`. A 404 means
the approval is settled or out of scope: one explicit `CREW SETTLED …` notice,
no retry. Any other failure is retried three times with a backoff, then
written to the journal of record as `CREW RESOLVE FAILED <id> after 3 tries`:
a lost resolution is never silent.

## Configuration

| Variable | Default | Role |
|---|---|---|
| `CREW_GATEWAY_URL` | `http://localhost:{KIROCREW_PORT or 5476}` | Gateway base |
| `CREW_APP_NAME` / `KIROCREW_APP_NAME` | `bipeur` | app identity for token exchange |
| `KIROCREW_PROXY_SECRET` / `CREW_APP_SECRET` | — | app secret (env-injected; else the `.app_secret` file) |
| `CREW_TOKEN_PATH`, `CREW_WS_PATH`, `CREW_APPROVAL_PATH`, `CREW_GLOBAL_APPROVAL_PATH`, `CREW_NOTIFICATION_PATH` | the real Gateway paths | overrides for tests and unusual deployments |
| `BIPEUR_URL` | `http://127.0.0.1:8787` | Beeper Central |
| `BIPEUR_TOKEN` | — | station token, required, never logged |
| `BIPEUR_STATION` | `crew` | station alias on the page line |
| `CREW_PAGE_TTL` | `900` | page lifetime, seconds |
| `CREW_QUEUE_LIMIT` | `200` | bound of the local event queue |
| `CREW_BACKOFF_MS` / `CREW_MAX_BACKOFF_MS` | `500` / `30000` | bounded exponential backoff (the official client's shape) |
| `CREW_RESOLVE_ATTEMPTS` | `3` | attempts before the explicit notice |
| `CREW_WAIT_SECONDS` | `50` | ceiling of one decision long-poll |

## Permissions (declared in `app.json`, enforced by the Gateway)

- `permissions.api`: `/api/chat/slots` and `/api/approvals` — the two approval
  families, nothing else. (`/api/ws`, the token exchange and
  `/api/notifications/push` are protocol-layer / implicitly allowed.)
- `permissions.events`: `slots:user` (slot-scoped frames of user sessions —
  where the approvals we carry live), `notification:system`, and the two
  task events.
- `permissions.sessionApproval: true` — without it every decide answers 403
  `session_approval_not_granted`; expect a consent prompt at install.
- `notifications.channels`: one `journal` channel for the notices the relay
  mirrors into the Crew notification bus.
- `network: true` — the relay dials the Beeper Central.

`test/manifest.test.ts` fails if the declaration and the paths the code calls
drift apart, in either direction.

## Reliability

- **Reconnection**: bounded exponential backoff; each attempt re-reads the
  cookie, so a token rotated during a cut rides the next handshake.
- **No lost frame on a cut**: a bounded local queue (`CREW_QUEUE_LIMIT`) holds
  frames while the Central or the Gateway is away; past the bound the oldest
  is dropped **and counted in the log**, never silently.
- **Idempotence**: one approval record (`id` + `instance`) gives one page
  (Central dedupe key) and one resolution (Gateway `response_id` replay).
- **Fail closed**: an expired page or an unreachable Central resolves to a
  denial.
- **No sound**, no secret, no token and no event payload in the logs.

## The page

`ui/page.mjs` is the `ui.pages[].entryPoint` the host mounts through the
exported `mount(el)`. It imports `react` and `@kirocrew/app-sdk` as **bare
specifiers** — resolved by the dashboard's import map at runtime, never
npm-installed, which is why the file ships as plain source with no bundler.
It inherits the host theme (`useTheme`) instead of imposing colors, shows the
approvals currently on the pager line (`useAppEvents`), and is **read-only**:
a decision must be signed by the paired pager, never taken from a dashboard
tab.

## Tests

`pnpm test` — unit doubles for the fast paths, plus
`test/gateway-contract.test.ts`: the relay end-to-end against a fake Gateway
that implements the real contract (token exchange, cookie auth, `/api/ws`
frames, the decide route with its exact refusal codes, `response_id` replay,
notification push). It proves: approval → one page → exactly one resolution;
denial → rejected **with the reason**; failure → three attempts then an
explicit journal notice; expired token → transparent re-auth, no approval
lost; WS drop → reconnect, order kept, no duplicate; journal events → notice,
never a beep; missing `sessionApproval` → refused and reported, never silent.
No test touches a real Gateway or the machine's real secret file.
