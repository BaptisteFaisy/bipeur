# Deployment — one process, one SQLite file, one URL (BIP-N-09)

Four ways to host the Central + the pager, from "one command on a bare machine"
to "one command in the cloud". All of them serve the same thing: the Hono API,
the WebSocket stream and the built pager on **one HTTP port**, with the state in
**one SQLite file**.

| Way | Files | Best for |
|---|---|---|
| **Tailscale Funnel — LIVE** | `bipeur-central.service` (systemd user unit) | the public demo instance for the judges, right now |
| Modal (CPU, scale-to-zero) | `deploy/modal_app.py` | a cloud URL, once the workspace spend limit allows it |
| Docker / docker compose | `Dockerfile`, `docker-compose.yml`, `.dockerignore` | any container host, self-hosting |
| Bare Node | — | a machine with Node ≥ 22.13 and pnpm ≥ 10 |

Common to all three: `BIPEUR_DB` points at the SQLite file, `BIPEUR_DEMO=1`
turns on the no-account demo mode (spaces wiped after 24 h), and no secret is
ever stored in the repository — tokens and VAPID keys come from the
environment.

---

## 1. Modal

`deploy/modal_app.py` builds the whole workspace inside a **CPU-only** image
(`node:24-slim` + Python sidecar, `gpu=None` — this app never requests a GPU),
mounts a persistent `modal.Volume` named `bipeur-data` at `/data` for the
SQLite file, and exposes the Central through `@modal.web_server` on port 8787.

### Deploy

```bash
# once: an authenticated Modal profile (modal profile list)
modal deploy deploy/modal_app.py
# → prints the public URL, e.g. https://central--bipeur-central--<slug>.modal.run
```

The function scales to zero when idle (`scaledown_window=300`) and wakes on
the first request, so the URL stays valid at no cost between visits — this is
what makes "hosted until 29 January 2027" free.

### Current status of the public instance

**Live since 2026-11-11 on Tailscale Funnel — see section 4 below.**

The Modal deployment was **refused** on 2026-11-11 with the exact error:

```text
Workspace ac-3lgJFhzO8zTGDFvgAszRD4 has exceeded its spend limit
```

Nothing was forced (no other app was touched, no guard bypassed), and both
configured profiles resolve to that same workspace, so switching profile changes
nothing. To publish on Modal later: raise or reset the workspace spend limit in
the Modal dashboard (Settings → Billing), then run
`modal deploy deploy/modal_app.py` — idempotent, prints the public URL. The
Docker way below is built and verified in the meantime.

### Web Push (BIP-F-19) — three variables and one script

Web Push is off until VAPID keys exist. Without them the Central logs nothing,
sends nothing, and the pager falls back to the WebSocket stream — which is enough
as long as the pager is open, and is the documented fallback.

```bash
# 1. generate a pair (prints three lines, writes no file: nothing to commit)
pnpm --filter @bipeur/central exec node scripts/vapid.mjs

# 2. put them in the environment of the Central — .env locally, or the
#    Environment= lines of the systemd unit, or a Modal Secret
BIPEUR_VAPID_PUBLIC_KEY=B…      # public, published on GET /v1/push-config
BIPEUR_VAPID_PRIVATE_KEY=…      # secret: environment only, never the repository
BIPEUR_VAPID_SUBJECT=mailto:you@example.com

# 3. restart, then check
curl -s https://<host>/v1/push-config
# → {"enabled":true,"vapid_public_key":"B…"}
```

What happens then, end to end:

| Step | Who | What |
|---|---|---|
| 1 | pager | `GET /v1/push-config` → the VAPID **public** key |
| 2 | pager | `pushManager.subscribe({userVisibleOnly, applicationServerKey})` |
| 3 | pager | the subscription, plus the operator's lock-screen masking flag, goes to the Central at pairing |
| 4 | Central | on delivery, `web-push` sends to every non-revoked device of the right visitor scope |
| 5 | service worker | `public/sw-notify.js` shows the notification: action buttons for a **green** page only, `requireInteraction` for a red one, never a sound |

Masking (BIP-F-21, BIP-N-04) is enforced **server side**: when the device asked
for it, the payload carries the code and the station and not the line, so a
locked screen — and the notification store — cannot leak the command.

Not verified on a real device: whether a given platform renders notification
action buttons (BIP-N-07 marks this "to verify"). The pager degrades to opening
the app, which is the documented fallback and what a red page requires anyway.

### Optional secret (Web Push, fixed station token)

By default the Modal instance boots in demo mode with safe defaults: a
generated station token, WebSocket delivery, no Web Push. To enable Web Push
or pin the bootstrap token, create a named Modal Secret and pass its name at
deploy time — the values never appear in the repository nor in the logs:

```bash
modal secret create bipeur-demo \
  BIPEUR_BOOTSTRAP_TOKEN=<token> \
  BIPEUR_VAPID_PUBLIC_KEY=<public key> \
  BIPEUR_VAPID_PRIVATE_KEY=<private key> \
  BIPEUR_VAPID_SUBJECT=mailto:you@example.com

BIPEUR_MODAL_SECRET=bipeur-demo modal deploy deploy/modal_app.py
```

### Persistence and backup on Modal

- The SQLite file lives on the Volume: `BIPEUR_DB=/data/bipeur.sqlite`.
- Demo spaces are wiped after 24 h by the Central itself; the audit log stays.
- Backup = copy the file: `modal volume get bipeur-data bipeur.sqlite ./backup.sqlite`.
- Redeploy: `modal deploy deploy/modal_app.py` (the volume survives redeploys).
- Known limitation: `modal.run` exposes HTTP(S) only, so the SNPP TCP gateway
  (port 4440, `packages/snpp`) is not reachable on Modal — use Docker with a
  published port, or bare Node, for RFC 1861 sessions.

---

## 2. Docker

`Dockerfile` is multi-stage: `node:24-slim` builds the workspace
(`pnpm install --frozen-lockfile && pnpm build`), then
`pnpm --filter @bipeur/central --prod deploy --legacy /deploy` produces a
self-contained production bundle of the Central (its `dist` plus production
dependencies only — `@bipeur/core` included, no dev tooling). The runtime
stage is a bare `alpine:3.24` with the stripped musl Node 24 binary copied
from `node:24-alpine` — no npm, no corepack — running as an unprivileged
`node` user, with `VOLUME /data`, `EXPOSE 8787` and a `HEALTHCHECK` on
`/healthz` (`deploy/healthcheck.mjs`). Result: **193 MB** (`docker image ls`;
136 MB of contents via `docker export`), under the 200 MB target of BIP-N-09.

```bash
docker compose up -d --build     # reads .env automatically (see .env.example)
# or without compose:
docker build -t bipeur-central .
docker run -d --name bipeur-central -p 8787:8787 \
  -v bipeur-data:/data \
  -e BIPEUR_DEMO=1 \
  bipeur-central
```

- Persistence: the named volume `bipeur-data` holds `/data/bipeur.sqlite`.
- Backup = copy the file:
  `docker run --rm -v bipeur-data:/data -v "$PWD":/out alpine cp /data/bipeur.sqlite /out/backup.sqlite`
- Environment: every `BIPEUR_*` variable of `.env.example` is forwarded by
  `docker-compose.yml` from the shell or from `.env`; no value is stored in
  the compose file.
- Redeploy: `docker compose up -d --build` (the volume is untouched).

### Verified locally (2026-11-11, x86-64 Linux)

```console
$ docker image ls bipeur-central:test
REPOSITORY         TAG     SIZE
bipeur-central     test    193MB          # docker export: 136 MB of contents

$ docker run -d --name bipeur-check -p 18787:8787 -v bipeur-check-data:/data \
    -e BIPEUR_DEMO=1 bipeur-central:test
$ docker logs bipeur-check | head -4
[central] listening on http://0.0.0.0:8787
[central] database /data/bipeur.sqlite
[central] rules /app/.bipeur/rules.yaml
[central] budget 6/h, retention 30d

$ curl -sS http://127.0.0.1:18787/healthz
{"ok":true,"version":"0.1.0"}

$ curl -sS -o /dev/null -w "%{http_code}" http://127.0.0.1:18787/
200                                    # serves the pager PWA HTML

$ curl -sS -X POST http://127.0.0.1:18787/v1/demo/start
# → 201, fields (values masked): visitor_id, station_token, device_token,
#   device_id, pager_url, expires_at, device_private_key_jwk{kty,x,y,crv,d}

$ docker inspect bipeur-check --format '{{.State.Health.Status}}'
healthy                                # HEALTHCHECK on /healthz

$ docker exec bipeur-check ls /data
bipeur.sqlite  bipeur.sqlite-shm  bipeur.sqlite-wal   # the single SQLite file
```

The WebSocket stream was also verified against this container: a device token
from `/v1/demo/start` connects to `/v1/stream` and receives
`{"type":"hello","central":"bipeur-central/0.1.0", ...}`.

---

## 3. Bare Node

```bash
pnpm install --frozen-lockfile
pnpm build
BIPEUR_HOST=0.0.0.0 BIPEUR_DB=/var/lib/bipeur/bipeur.sqlite BIPEUR_DEMO=1 \
  node packages/central/dist/bin.js
```

- One process serves the API, the WebSocket stream and the pager
  (`packages/pager/dist` is resolved relative to the compiled Central).
- The bootstrap station token is printed **once** at first boot when
  `BIPEUR_BOOTSTRAP_TOKEN` is empty.
- Backup = copy the SQLite file (stop the process first, or copy the `-wal`
  and `-shm` siblings too).
- Run it under systemd/any supervisor with `Restart=always`; the store is
  crash-safe (BIP-P-12) and a restart never loses a pending page.

---

## Web Push (VAPID)

Web Push needs HTTPS and a VAPID key pair. Generate one with the `web-push`
package already in the workspace:

```bash
pnpm --filter @bipeur/central exec web-push generate-vapid-keys
```

Then set `BIPEUR_VAPID_PUBLIC_KEY`, `BIPEUR_VAPID_PRIVATE_KEY` and
`BIPEUR_VAPID_SUBJECT` (`mailto:` or `https:`) in the environment of the
Central — via `.env` for Docker/bare Node, via a Modal Secret for Modal.
Without them the push sender is a no-op and the pager falls back to the
WebSocket stream, which is enough for the whole demo.

## 4. GitHub Pages — the whole product, served from the repository

```
https://baptistefaisy.github.io/bipeur/             the showcase (landing)
https://baptistefaisy.github.io/bipeur/app/         the pager PWA
https://baptistefaisy.github.io/bipeur/docs/        the documentation, rendered
https://baptistefaisy.github.io/bipeur/dashboard/   the Central's dashboard, framed
```

Everything static can live on GitHub Pages — free, permanent, attached to the
repository, and deployed by a workflow on every merge
(`.github/workflows/pages.yml`). The `@bipeur/site` package assembles the tree:
a landing that lists every feature (app, demo, dashboard, docs, integrations),
the pager's own vite build copied under `app/`, the markdown of `docs/`
rendered to HTML, and the dashboard framed under `dashboard/` so the operator
never leaves the site (the frame's source stays the Central — the token entry
and the data live on its origin). The Central stays a server; the browser calls
it directly, which needs two things:

- **CORS on the Central** for the Pages origin. `BIPEUR_CORS_ORIGINS` lists the
  allowed origins (default: `https://baptistefaisy.github.io`). It is an explicit
  list: `*` would let any site on the internet use a token it stole.
- **Chrome's Private Network Access.** For a browser on the tailnet, the
  Central's funnel name resolves to a `100.64/10` address — a "private" space —
  and a public page calling it is blocked unless the preflight answers
  `Access-Control-Allow-Private-Network: true`. The Central sends it, for the
  allowed origins only.
- **The Central's address in the pager**, resolved in this order (see
  `packages/pager/src/api/central-url.ts`): `?central=https://…` in the page URL,
  then the address the pager remembers in `localStorage`, then the one baked into
  the build (`PAGER_CENTRAL_URL`), then same origin — which is the case when the
  Central serves the pager itself.

Everything absolute in each build follows its own base path: `PAGER_BASE` is
`/bipeur/app/` on Pages (the Central serving the pager keeps `/`), and the
landing and the docs are generated with `SITE_BASE=/bipeur/`, so the assets, the
manifest's `start_url`, the service worker and the notification layer all resolve
under the right prefix. A deep link `?screen=demo` (or `memory`, `settings`,
`pairing`) opens the pager straight on that screen.

**One caveat, stated rather than hidden.** On `github.io` every repository page
shares the same origin, hence the same `localStorage`: another Pages site of the
same account could read what the pager stored there (the device token, not the
private key — that one is non-extractable and never leaves the page). The
same-origin deployment, where the Central serves the pager, has no such exposure.

### 4b. Tailscale Funnel — the Central, also public

```
https://r630-debian.tail3a8bdf.ts.net/
```

Free, HTTPS, no account for the visitor, no port forwarding, and it stays up as
long as the host does. Tailscale terminates TLS at the edge and proxies to a
process listening on the loopback only, so nothing else on the machine is
reachable from the internet.

### What runs

| | |
|---|---|
| Host | `r630-debian` (Debian 13, headless, on the tailnet) |
| Checkout | `/home/baptiste/bipeur-demo`, branch `main` |
| Service | `bipeur-central.service` (systemd **user** unit, `Restart=always`, linger on) |
| Bind | `127.0.0.1:8813` — loopback only, never `0.0.0.0` |
| Funnel | `sudo tailscale funnel --bg 8813` → `https://r630-debian.tail3a8bdf.ts.net/` |
| Database | `/home/baptiste/bipeur-demo/data/bipeur.sqlite` (WAL) |
| Mode | `BIPEUR_DEMO=1`, budget 6 pages/hour, retention 30 days |
| Hardening | `NoNewPrivileges`, `PrivateTmp`, `ProtectSystem=full`, `ReadWritePaths` limited to `data/` |

Port 8787 was already taken on that host by another service, hence 8813.

### Reproduce it

```bash
# on the host, once
git clone https://github.com/BaptisteFaisy/bipeur.git bipeur-demo && cd bipeur-demo
pnpm install --frozen-lockfile && pnpm build
mkdir -p data
# install the unit (see the table above for the environment), then
systemctl --user enable --now bipeur-central.service
sudo tailscale funnel --bg 8813

# update after a merge
cd ~/bipeur-demo && git pull && pnpm install --frozen-lockfile && pnpm build \
  && systemctl --user restart bipeur-central.service

# take it down (one command, nothing else changes)
sudo tailscale funnel --https=443 off
```

### Verified from outside the tailnet (2026-11-11)

```text
GET  /healthz          → 200 {"ok":true,"version":"0.1.0"}
GET  /                 → 200, the pager PWA (701 bytes of HTML)
POST /v1/demo/start    → 201, visitor_id + station_token + device_token + key pair
POST /v1/pages         → "110 demo RUN rm -rf packages/ #65e2", risk red, delivered
WSS  /v1/stream?token= → {"type":"hello","central":"bipeur-central/0.1.0","budget":6}
                         then page.delivered with the SAME fingerprint
GET  /v1/metrics       → 200, the indicators of A.3
```

The WebSocket works through the funnel, which is the one thing that had to be
proven: without it a judge would see a pager stuck on "offline".

### Reachable from any IP — measured, not assumed

The host is behind NAT (no public address of its own: `eno1` is `192.168.2.193`,
its egress IP is `46.193.66.237`), so "public" here means the Funnel edge, not a
port forward. Two things had to be proven, because a check from the workstation
is worthless: that machine is **inside** the tailnet, and Tailscale's MagicDNS
answers `100.124.18.48` instead of the edge — a local test silently proves the
tailnet path, never the internet path.

**1. From the internet, 53 vantage points** (`check-host.net`, `GET /healthz`):

```text
fr2 200 in 0.111 s   de1 200 in 0.246 s   uk1 200 in 0.136 s   us1 200 in 0.586 s
jp1 200 in 0.899 s   sg1 200 in 0.849 s   br1 200 in 0.815 s   in1 200 in 0.895 s
au/il/tr/pl/se/nl/pt/ro/rs/ru/ua/hu/si/es/it/ch/at/md/is/kz/vn/id  200
→ 53 nodes, ~30 countries, every one HTTP 200, edge IPs 176.58.90.{46,63,145}
```

**2. Through the edge IP, with the tailnet path ruled out.** Resolution forced
onto `176.58.90.46` (`curl --resolve` for HTTP, a custom `https.Agent({lookup})`
for the socket), so the request cannot fall back to `100.124.18.48`:

```text
GET  /healthz    → 200 via 176.58.90.46 in 0.196 s
GET  /           → 200 via 176.58.90.46 in 0.095 s
GET  /dashboard  → 200 via 176.58.90.46 in 0.102 s
WSS  /v1/stream?token=…  opened via 176.58.90.46
     ← {"type":"hello","central":"bipeur-central/0.1.0","budget":6}
     ← page.delivered  "100 demo RUN cannot reach registry (3 tries) #2eb5"
       fingerprint identical to the one POST /v1/pages returned
```

The WebSocket is the part that mattered: Funnel proxies the `Upgrade`, so a
judge on 4G gets a live pager and not one stuck on `offline`.

An independent third-party fetcher (`r.jina.ai`, which renders pages from its own
network) returned the real pager screen — `Title: Beeper`, `No pages. Your agents
are fine.`, `Keys: Enter approves, Escape refuses, Down scrolls, A-D choose`.

**A trap worth recording.** The first socket test appeared to fail: the page was
created but never pushed. It was not the tunnel — it was the **attention budget**,
saturated by the previous demo spaces (`pages_created: 46, pages_delivered: 29`).
A red page, which bypasses the budget by design (BIP-P-08), went straight
through. Two lessons: probe a rate-limited system with something that bypasses
the limit, and demo visitors must not share one budget (fixed separately).

### Known limits of this instance

- **No Web Push**: no VAPID keys are set, so `push.notify` is a no-op that
  writes to the log. The WebSocket stream is the delivery path — exactly the
  documented fallback (BIP-F-19). Add `BIPEUR_VAPID_*` to the unit to enable it.
- **Single host**: no replica. If `r630-debian` reboots, systemd and the funnel
  config both come back on their own; if the host dies, redeploy elsewhere with
  the same three commands.
- **The URL is a Tailscale one** (`*.ts.net`), not a custom domain. It is stable
  and public, but it says what it is; a custom domain would need a real reverse
  proxy in front, which is the Modal or Docker route.
- **Demo mode is on**, so anyone reaching the URL can open a visitor space. That
  is the point (no account for the judges), each space is isolated and wiped
  after 24 h, and the audit log keeps 30 days.

## Choosing

- **Judges / public demo**: the live Funnel URL above. Modal remains the cleaner
  long-term answer (scale-to-zero, no host of ours in the path) once its spend
  limit is lifted.
- **Self-hosting**: Docker compose on any box; add a reverse proxy (Caddy,
  nginx) for HTTPS and Web Push.
- **Development**: bare Node (`pnpm central` + `pnpm pager`).
