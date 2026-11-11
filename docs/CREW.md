# The real Crew Gateway contract

What the Beeper Crew app talks to, and where each fact comes from. The contest
specification marked these paths "to verify" (A.9, A.15); they are now
established from two primary sources, read on 2026-11-11:

1. **Official docs** — `kiro.dev/docs/crew/apps/sdk/`, `.../manifest/`,
   `.../build-first-app/` (pages updated 2026-09-25 / 2026-08-04).
2. **Official source** — `github.com/kirodotdev/KiroCrew` (open-source
   edition, cloned at depth 1 on 2026-11-11): the Python client
   `packages/kirocrew-client-py/kirocrew_client/` **and the Gateway server
   itself** (`src/kiro_crew/dashboard/...`). `pip install kirocrew-client`
   finds nothing on PyPI (404 on `pypi.org/pypi/kirocrew-client/json`) — the
   package ships inside the Crew repo, which turned out to be better: the
   server code is the ground truth the client is written against.

## Established (source-cited)

| Fact | Value | Source |
|---|---|---|
| Gateway base URL | `http://localhost:{KIROCREW_PORT or 5476}` | SDK doc; `client.py __init__` |
| No npm client | Node apps call REST/WS with `fetch()` directly | SDK doc, "Choosing the right SDK" |
| App secret | `KIROCREW_PROXY_SECRET` env (Gateway-launched backends, beside `KIROCREW_APP_NAME`), else `${KIROCREW_HOME\|~/.kiro/crew}/apps/{name}/.app_secret` | `client.py _read_app_secret` |
| Token exchange | `POST /api/apps/{name}/token`, header `X-App-Secret`, answers `{"token": ...}`; opaque 403 on any refusal | `handlers/core.py api_app_token`; `routes/system.py:319` |
| Token transport | Cookie `mc_token_<port>=<token>` on every request **and the WS handshake**; `<port>` = Host port, scheme default 80/443 | `client.py _auth_cookie_name/_cookie_headers` |
| Token expiry | 401/403 → exchange again once, then retry (`AUTH_EXPIRED` is never blind-retried) | `client.py _request`; `errors.py` |
| Event stream | `GET {base}/api/ws`; every frame is `{"type": <event>, "data": {...}}`; slot-bound events carry `data.slot` | `ws_client.py` docstring; `routes/realtime.py:42` |
| WS reconnect policy | exponential backoff, base 1 s, cap 30 s | `ws_client.py compute_reconnect_delay` |
| `approval` payload | `{id, instance, source, tool, tool_input, tool_purpose, slot, ts, run_task_id?, task_index?}` — `instance` (uuid4) names *this* request because `id` can recur | `interaction_coordinator.py ApprovalCoordinator.request` |
| Slot decide route | `POST /api/chat/slots/{slot}/approve`, body `{action: "approved"\|"rejected", request_id, response_id?}` → `{"ok": true}` | `chat_api/slot_approval.py api_chat_slot_approve` |
| Rejection reason | only the **native form** carries it: `{origin:"native", request_id, request_mid:<instance>, action:"rejected", reason}`; any other caller sending `reason` gets 400 `invalid_rejection_reason` | `slot_approval.py` ("reason: what the person typed…") |
| `response_id` | optional stable id naming one decision: a retry **replays the same outcome** (Gateway-side idempotence) | `slot_approval.py`; `shared_crew/decisions.py read_response_id` |
| Global decide route | `POST /api/approvals/{id}/{approve\|reject\|reject_once}`; with an app token it resolves only when **exactly one** controllable slot owns the id, else 404 | `sessions_parts/live_turn.py _resolve_app_approval` |
| Approval permission | an app token needs `permissions.sessionApproval: true` in its manifest, else 403 `{"code":"session_approval_not_granted"}` — even for its own slots; background (cron/subagent/taskrunner) approvals are **never** app-resolvable and `GET /api/approvals` returns `[]` to apps | `slot_approval.py deny_session_approval_caller`; `live_turn.py api_approvals`; `manifest_sections.py Permissions.sessionApproval` |
| Settled/unknown approval | 404 `approval_not_pending` — terminal, must not be retried | `slot_approval.py` |
| WS event scoping | **enforced** for app tokens (the manifest doc's "advisory" note is older than the code): `approval` is slot-scoped, so seeing user-session approvals requires `permissions.events: ["slots:user"]`; `notification` (own app) / `notification:system` are separate declarations | `ws_event_scope.py` (tiers, `_SLOT_SCOPED_EVENTS`, `_GLOBAL_EVENT_DECLARATIONS`) |
| API path scoping | `permissions.api` prefixes, deny-by-default, path-boundary matching (`/api/chat` matches `/api/chat/slots` but not `/api/chatx`); `/api/ws`, `/api/notifications/push` and the app's own paths are implicitly allowed | `token_auth_app_scope.py app_token_path_allowed/_api_pattern_matches` |
| Notification producer | `POST /api/notifications/push` `{channel, title, body, priority?}`; channel must be declared in manifest `notifications.channels`; source is server-stamped `app:{name}`; rate-limited 429 | `handlers/notifications_push.py`; `manifest_sections.py NotificationChannel` |
| Manifest required fields | `name` (kebab-case), `version` (semver), `displayName`, `description`; UI pages under `ui.pages[]` (`route`, `label`, `entryPoint`, `mountFunction` default `"mount"`); backend under `backend` (`entryPoint`, `type: "node"`) | manifest reference doc; `manifest_sections.py` |
| Dashboard UI | pages import `@kirocrew/app-sdk` hooks + `/ui` components as **bare specifiers** resolved by the host import map (`window.__kirocrew_modules`) — never npm-installed; React/ReactDOM/lucide come from the host too | build-first-app doc ("You do not npm install…") |
| Error codes / retries | 401,403→`AUTH_EXPIRED` (no blind retry), 404→`NOT_FOUND`, 429→`RATE_LIMITED` (retry), 5xx→`SERVER_ERROR` (retry, backoff), timeout→`NETWORK_ERROR` (retry) | `errors.py http_status_to_code`; SDK doc error table |
| Security helpers | `ctx.scrub.outbound` / `ctx.audit.record` exist **only inside in-Gateway Python hooks** (`backend.hooks.*`); a standalone backend process does not receive them | SDK doc "App security helpers" |
| Reverse-proxy HMAC | `HMAC-SHA256(timestamp:method:/api/path[?query]:sha256(body))`, ±60 s window, constant-time compare — protects `*/apps/{name}/api/{path}` requests *into* an app backend | SDK doc; build-first-app doc |

## Inferred (reasonable, not source-proven)

- **`instance` is the `request_mid` of the native form.** `_strict_native_owner`
  compares `request_mid` against `approval_instance(request_id)`, and the
  broadcast record's only per-request stamp is `instance`. Nothing explicitly
  says an *app* caller may use the native form; the route does not refuse it
  (the app check is `deny_app_session_control`, run before, and `reason`
  validation passes with `origin:"native"`). The relay therefore sends the
  native form for denials and **falls back to the plain form without the
  reason on a 400** — a refusal degrades to a reason-less denial, never to a
  lost decision.
- **`response_id = "bipeur:{instance}:{a|d}"`** gives cross-retry idempotence
  (the Gateway replays the settled outcome for a known response id).
- **Journal notices** ride `/api/notifications/push` with the declared
  `journal` channel, in addition to the Beeper Central journal — both sides
  see failures.

## To verify on a real Crew (nothing here is guessed in code)

No Crew Gateway exists on this machine: `ls ~/.kiro/crew` → absent;
`curl --max-time 3 http://localhost:5476/api/status` → connection refused.

| # | Question | Command / check that day |
|---|---|---|
| 1 | Does the Gateway launch our `backend` (a non-HTTP node process) and keep it up without a `healthCheck` route? The manifest reference defaults `healthCheck` to `/health`; our relay serves no HTTP. | Install the app, `curl -X POST localhost:5476/api/apps/install -d '{"source":"./packages/crew-app"}'`, enable, watch the backend stay up; if it is restarted for failed health, add a minimal `/health` listener or declare `healthCheck: ""`. |
| 2 | Does the host mount `ui/page.mjs` via `mount(el)` with the bare imports resolved (React, `@kirocrew/app-sdk`)? | Open the dashboard page `/apps/bipeur` with dev mode on (`kirocrew app dev bipeur`) and check the approval list renders and inherits the theme. |
| 3 | Does `permissions.sessionApproval` trigger the install-time consent prompt (docs mention `sessionApprovalConsent` in `cli_commands_app.py`)? | Install and confirm the prompt names Beeper; the app must be consented before resolves succeed. |
| 4 | Native-form denial from an app token (inferred above): accepted with the reason, or 400? | Deny once from the pager with a reason; check the Gateway log for `invalid_rejection_reason` vs. the agent receiving the reason. The fallback path keeps decisions safe either way. |
| 5 | `task_update` / `task_complete`: listed in the SDK doc's event list, but the only emitters found in the open-source tree are app-internal (mochi) and the Slack client. Do they ever reach `/api/ws`? | `wscat`-style listen with `permissions.events` declaring them; the relay journals them without paging if they arrive. |
| 6 | Cookie port behind a reverse proxy (the client exposes `cookie_port` for rewritten Host headers). | If Beeper talks to a remote Gateway, set `CREW_GATEWAY_URL` to the real listen port or extend config with a cookie-port override. |

## What this means for the app

- The relay authenticates for real: secret from env/file at runtime, token
  exchanged and rotated on 401/403, never logged, never in the repo.
- Approval resolution targets the **slot decide route** with the broadcast
  `slot`; the global route is the fallback for frames without one.
- The manifest declares exactly what the code uses: `api` = the two approval
  families, `events` = `slots:user` + `notification:system` (+ the two task
  events, literal names), `sessionApproval`, `network` (the relay dials the
  Beeper Central), and one notification channel. A test
  (`test/manifest.test.ts`) fails if code and declaration drift apart.
- The page is a host-mounted ESM module using the host's React and SDK hooks
  (`useAppEvents`, `useTheme`, `useAppInfo`) — it inherits the dashboard
  theme instead of imposing colors, and stays read-only: only a signed pager
  decision resolves an approval.
- The relay is a **standalone backend process**, not an in-Gateway hook, so
  `ctx.scrub.outbound`/`ctx.audit.record` are not available to it (SDK doc
  says so explicitly). What still applies: the Gateway already redacts
  `tool`/`tool_input`/`tool_purpose` before broadcasting (`_redact` in
  `ApprovalCoordinator.request`), and the relay never logs event payloads,
  secrets or tokens; decisions are audited in the Beeper journal of record
  and mirrored to the Crew notification bus. No inbound proxy surface exists
  (the page talks to the host, not to our backend), so HMAC verification is
  not applicable — documented instead of implemented.
