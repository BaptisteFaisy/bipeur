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

## 4. Tailscale Funnel — the live public instance

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

### Known limits of this instance

- **No Web Push**: no VAPID keys are set, so `push.notify` is a no-op that
  writes to the log. The WebSocket stream is the delivery path — exactly the
  documented fallback (BIP-F-19). Add `BIPEUR_VAPID_*` to the unit to enable it.
- **Single host**: no replica. If `r630-debian` reboots, systemd and the funnel
  config both come back on their own; if the host dies, redeploy elsewhere with
  the same three commands.
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
