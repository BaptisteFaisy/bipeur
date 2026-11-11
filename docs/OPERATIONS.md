# Operations — the public Beeper instance, end to end

Runbook for the instance the judges will visit:

```
https://r630-debian.tail3a8bdf.ts.net
```

Everything below was **measured** on the real host on 2026-11-11, not assumed.
The numbers in this file are the ones in the logs of the run.

| | |
|---|---|
| Host | `r630-debian` (Debian 13, 80 cores, **shared with five other agents**) |
| Clone | `/home/baptiste/bipeur-demo`, branch `main` |
| Service | `bipeur-central.service` (systemd **user** unit, `Restart=always`, linger on) |
| Bind | `127.0.0.1:8813` — loopback only |
| Funnel | `sudo tailscale funnel --bg 8813` (TLS terminated at the Tailscale edge) |
| Database | `/home/baptiste/bipeur-demo/data/bipeur.sqlite` (WAL) |
| Commit running | `abba6d5` (= `origin/main`), deployed by `tools/ops/deploy.sh` on 2026-11-11 |
| Backups | `/home/baptiste/bipeur-backups/` on the host, mirrored to the workstation |
| Supervision | `bipeur-watchdog.timer` (local, every minute) + `.github/workflows/uptime.yml` (external, every 10 min) |

---

## 1. The three commands you will actually need

```bash
# 1. update the running instance after a merge on main (with rollback)
cd /home/baptiste/bipeur-demo && ./tools/ops/deploy.sh

# 2. take a backup and PROVE it restores
./tools/ops/backup.sh
./tools/ops/verify-restore.sh --archive "$(ls -1t ~/bipeur-backups/bipeur-*.tar.gz | head -1)"

# 3. check that the public URL answers, from outside the tailnet
curl -sS https://r630-debian.tail3a8bdf.ts.net/healthz   # {"ok":true,"version":"0.1.0"}
```

---

## 2. Update after a merge (one command, rollback included)

`tools/ops/deploy.sh` does, in order: preflight (no local modification to a
tracked file) → snapshot of the database → `git fetch` → `git reset --hard` to
the resolved commit → `pnpm install --frozen-lockfile` → `pnpm build` →
`systemctl --user restart` → wait for `/healthz` to answer `{"ok":true}` **and**
`/` to serve the pager page → report the downtime. If any step after the reset
fails, it goes back to the previous commit, rebuilds, restarts and verifies
again; it exits non-zero with both verdicts in the log.

Measured on the r630, 2026-11-11 (`/tmp/deploy-test.log`):

```text
[deploy 19:38:46Z] running commit 25264dfc
[deploy 19:38:47Z] target origin/main = abba6d5b
[deploy 19:38:47Z] snapshotting the database before touching the code
[deploy 19:39:04Z] dependencies installed from the lockfile
[deploy 19:41:20Z] build ok                                  (2 min 16 s, loaded host)
[deploy 19:41:31Z] restarted instance: healthy — /healthz {"ok":true,...}, / 200 with the pager page
[deploy 19:41:31Z] downtime: 11 s from restart to healthy
[deploy 19:41:31Z] DONE abba6d5b is live and healthy
```

The public URL answered `200` before, during and after the operation.

Rollback by hand (if `deploy.sh` could not finish):

```bash
cd /home/baptiste/bipeur-demo
git reset --hard 25264dfc && pnpm install --frozen-lockfile && pnpm build
systemctl --user restart bipeur-central.service
curl -sS http://127.0.0.1:8813/healthz
```

---

## 3. Backup, and the proof that it restores

### Why a file copy is not a backup

Measured on the production host on 2026-11-11:

```text
data/bipeur.sqlite        4 096 bytes      <- the file a naive `cp` would copy
data/bipeur.sqlite-wal  1 034 152 bytes     <- where the data actually was
```

A plain `cp` of the `.sqlite` file produced a copy with **zero tables**
(`integrity_check` impossible, no `pages`, no `events`): restoring it would have
been a total loss. Every row written since the last checkpoint lives in the WAL.

### What `tools/ops/backup.sh` does instead

1. opens the live database and takes a **consistent snapshot through SQLite's
   Online Backup API** (`node:sqlite`'s `backup()`, with `VACUUM INTO` as a
   fallback) — safe while the service writes;
2. reopens the snapshot, runs `PRAGMA integrity_check`, counts the pages and
   the events, reads the last audit event;
3. writes `MANIFEST.json` (source, sha256, method, counts, last event, running
   commit, service state) and `watchdog.log` next to the database;
4. packs `bipeur-<UTC stamp>.tar.gz` + `.sha256` in `/home/baptiste/bipeur-backups`
   (outside the clone) and **verifies** the archive (members + sha256);
5. purges the oldest archives beyond the retention limit, one by one, logging
   each removal, and **never goes below three archives** whatever the limit is;
6. pushes the archive to the **workstation** over the tailnet and re-reads the
   sha256 there — a copy on a second machine, on a second disk.

Measured, 2026-11-11:

```text
[backup] snapshot ok: 122880 bytes, method online-backup-api
[backup] manifest written: pages=5 events=32 commit=25264dfc
[backup] archive bipeur-20261111T193023Z.tar.gz (7083 bytes)
[backup] archive verified: members present, sha256 matches
[backup] replica: sha256 verified on baptiste@100.120.194.92
```

### The restore proof

`tools/ops/verify-restore.sh` restores the archive into a temporary directory,
compares the restored database with the manifest (page count, event count, last
audit event), then **starts a real Central on the restored database** and waits
for `/healthz` and `/`.

Measured on the r630, 2026-11-11:

```text
[restore] sha256 verified
[restore] opened: integrity=ok pages=5 events=32
[verify] pages: 5 row(s), matches the manifest
[verify] events: 32 row(s), matches the manifest
[verify] last audit event: #32 page.expired, matches the manifest
[verify] healthy: /healthz -> {"ok":true,"version":"0.1.0"} ; / -> 200 with the pager page (701 bytes)
[verify] PASS — the archive restores, the data is intact and a Central serves it
```

### Timer

`bipeur-backup.timer` (systemd **user** unit, `tools/ops/units/`), every six
hours at :20, `Persistent=true` so a missed run is caught up after a reboot.
Measured: `NEXT = Thu 2026-11-12 00:20:00 CET`, and the first run produced
`bipeur-20261111T194150Z.tar.gz` (7003 bytes) plus its mirror on the
workstation.

> OnCalendar was chosen after a first attempt with `OnUnitActiveSec`: the
> oneshot takes 2 to 5 minutes on this loaded host and the timer was left with
> **no next elapse**. A timer that can silently stop scheduling is worse than
> no timer.

### Restore by hand

```bash
# stop the service, restore, start it
systemctl --user stop bipeur-central.service
./tools/ops/restore.sh --archive ~/bipeur-backups/bipeur-<stamp>.tar.gz \
  --target ~/bipeur-demo/data --force
systemctl --user start bipeur-central.service
curl -sS http://127.0.0.1:8813/healthz
```

---

## 4. Supervision

### Local: the watchdog (every minute)

`tools/ops/watchdog.sh`, driven by `bipeur-watchdog.timer` (user unit). It
probes `/healthz` and restarts the Central only when the instance is really
gone. Tuning, and why (the host is shared, load average measured between 42
and 138):

| parameter | value | why |
|---|---|---|
| `PROBE_TIMEOUT` | 30 s | the previous 15 s produced a **false** failure at 17:16:10 on a healthy instance |
| `PROBE_TRIES` | 3, 3 s apart | one slow answer never counts as a failure |
| `FAIL_THRESHOLD` | 5 runs (5 min) | 3 was too eager: two slow minutes would have restarted a healthy instance |
| `COOLDOWN` | 600 s | a slow boot can never be mistaken for a dead process |

The old tuning was **observed** misfiring during the 11 s restart of
`deploy.sh`:

```text
2026-11-11T20:41:31+01:00 healthz failed (1/3)      <- the old watchdog, during a planned restart
2026-11-11T20:42:34+01:00 ok again after 1 failed run(s)   <- the new one: one try, no strike
```

`tools/ops/watchdog-selftest.sh` proves the behaviour without touching any
service (4 scenarios, measured 2026-11-11, all PASS):

```text
A) slow but alive instance (answers after 5 s, probe times out after 2 s),
   shipped threshold 5, three failed runs      -> no restart, counter = 3
B) same instance under the OLD threshold 3      -> restarted (the loop risk was real)
C) dead port, threshold 2, four runs            -> exactly one restart, second suppressed by the cooldown
D) healthy instance                             -> counter reset to 0, recovery logged
```

### External: the uptime workflow (every 10 minutes)

`.github/workflows/uptime.yml` runs on the GitHub runners and probes the
**public** URL. The runner host sits on the same tailnet, where MagicDNS
answers the 100.x address of the r630 — a naive request would prove the
tailnet path and never the public one. The probe therefore resolves the name
against a public resolver (1.1.1.1, then 8.8.8.8, then DNS-over-HTTPS) and
pins the connection onto the Funnel edge address:

```text
$ dig +short @1.1.1.1 r630-debian.tail3a8bdf.ts.net A
176.58.90.46
176.58.90.63
176.58.90.145
```

Both paths are measured and labelled (`funnel-edge`, `default-dns`), so a red
edge sample next to a green tailnet sample means "Tailscale edge", not "the
Central is dead". The verdict requires **both** `GET /healthz` → 200 with
`{"ok":true}` **and** `GET /` → 200 with the real pager page (`<title>Beeper</title>`,
`/assets/`, `manifest.webmanifest`) — an error page is never counted as up.

**Where the history lives.** Every probe appends one JSON line to
`uptime-history.jsonl` on the branch **`ops/uptime-history`** (one file, no
code). `main` cannot receive them: it is protected (required status checks,
linear history, `enforce_admins`), and a pull request every ten minutes is not
a monitoring system. Pushing to that branch triggers **no** workflow: every
trigger in this repository is `pull_request` or `push: branches: [main]`.

```bash
python3 tools/ops/availability.py --jsonl uptime-history.jsonl --markdown
```

```text
**Measured availability: 100.0 %** over 0.001 days (6 probes, 6 up / 0 down).
- window: 2026-11-11T19:16:27Z → 2026-11-11T19:18:13Z (one probe every 21.2 s on average)
- public path (Funnel edge, DNS pinned): 6 of 6 samples
- /healthz latency: p50 261 ms, p95 7048 ms, max 7048 ms
- longest consecutive outage: 0 probe(s)
```

Those six seed samples were taken from the workstation, still over the public
Funnel edge (vantage `workstation-seed`); the GitHub-runner samples start with
the first scheduled run after the merge. Note the p95 of **7 s** on one of
them: the host was under load, and that is exactly the kind of number this
history exists to make visible over 79 days.

**On failure** the run turns **red** (the probe exits non-zero), the failed
sample is still written to the history, and the raw sample plus the last 200
history lines are kept as a 30-day artifact. **Nothing is ever restarted from
the runner**: a runner has no SSH access to the host, and must never have one.

To be told about a failure: watch the repository (All Activity) — GitHub sends
the notification itself. A dedicated alert channel (mail, a status page, a
chat webhook) is a human decision, see §7.

---

## 5. Failover

### The standby instance (already built, on the workstation)

`bipeur-standby.service` (systemd **user** unit on `baptiste-ms-7d18`),
clone `/home/baptiste/bipeur-standby`, bound to the **Tailscale address
only** — `100.120.194.92:8814`. No funnel is configured for it: the public
funnel stays on the r630, so there is never a second public instance.

Measured, 2026-11-11:

```text
$ curl -sS http://100.120.194.92:8814/healthz
{"ok":true,"version":"0.1.0"}
$ curl -sS -o /dev/null -w '%{http_code}\n' http://100.120.194.92:8814/
200                                  # the pager page, <title>Beeper</title>
```

### Switching the funnel to the standby (if the r630 dies)

The r630's own funnel dies with it, so the switch is done **on the
workstation**:

```bash
# 1. the standby must serve on the loopback (the funnel proxies to 127.0.0.1)
#    → change the unit: Environment=BIPEUR_HOST=127.0.0.1 (keep BIPEUR_PORT=8814)
systemctl --user daemon-reload && systemctl --user restart bipeur-standby.service
curl -sS http://127.0.0.1:8814/healthz

# 2. point the funnel at it
sudo tailscale funnel --bg 8814
tailscale funnel status

# 3. the public URL then becomes the standby's own name:
#    https://baptiste-ms-7d18.tail3a8bdf.ts.net
```

The URL changes with the host: that is the cost of a single-host URL, and the
reason a custom domain (a human decision, §7) would be better.

**Going back** to the r630:

```bash
# on the workstation
sudo tailscale funnel --https=443 off     # or: tailscale funnel reset
systemctl --user stop bipeur-standby.service
# on the r630
sudo tailscale funnel --bg 8813
curl -sS https://r630-debian.tail3a8bdf.ts.net/healthz
```

> The funnel command was **not** run on the workstation on purpose: it would
> have created a second public instance. What was verified is that the standby
> boots, serves `/healthz` and `/` on its tailnet address, and that the funnel
> configuration of the r630 is unchanged.

---

## 6. Single points of failure, and how long they stay invisible

| failure | detected by | delay | what to do |
|---|---|---|---|
| Central crashed | local watchdog | ≤ 5 min (5 failed runs) | the watchdog restarts it; `deploy.sh` if it does not come back |
| Central hung (answers /healthz, not /) | local watchdog | ≤ 5 min | same — but note the watchdog only probes `/healthz` |
| r630 host dead | **uptime workflow** (red run) | ≤ 10 min + GitHub's cron delay (minutes) | switch the funnel to the standby (§5) |
| r630 lost its network | uptime workflow (red edge sample) | ≤ 10 min | same |
| Tailscale edge down | uptime workflow (red edge, green tailnet) | ≤ 10 min | nothing to do on our side — Tailscale's incident |
| Disk full on the r630 | backup refuses (needs 200 MB free) + the Central's writes fail | minutes to hours | the host was at **93 %** on 2026-11-11; this is the most likely real failure |
| Database corrupted | `verify-restore.sh` on the next backup | 6 h | restore the last archive (§3) |
| The whole tailnet down | uptime workflow | ≤ 10 min | the URL is unreachable for everyone, including the judges |

**What it would take to hold 79 days** (until 29 January 2027): the uptime
history is the only proof, so it must keep running — that is what the workflow
is for. The host is shared and was at 93 % disk with a load average of 42 to
138; nothing in this repository can fix that, only a dedicated host (or the
Modal route, blocked by the spend limit) would.

---

## 7. What still needs a human decision

- **Alerting**: a red GitHub run is visible, but only to those watching the
  repository. A mail/webhook/status-page alert needs a channel and a secret.
- **A stable URL**: the URL is a `*.ts.net` name bound to one host. A custom
  domain would survive a failover, and is a decision (DNS + a reverse proxy).
- **The host itself**: shared with five other agents, 93 % disk, load up to
  138. A dedicated (cheap) host would remove the two most likely failures.
- **The watchdog probes only `/healthz`**: a Central that answers `/healthz`
  but not `/` would not be restarted. Extending the probe is a one-line change
  in `tools/ops/watchdog.sh`.

---

## 8. The units

`tools/ops/units/` holds the files installed on the two machines:

| unit | machine | what it does |
|---|---|---|
| `bipeur-central.service` | r630 | the Central itself (hardened, loopback bind) |
| `bipeur-watchdog.service` / `.timer` | r630 | probe every minute, restart after 5 failed runs |
| `bipeur-backup.service` / `.timer` | r630 | snapshot + mirror every 6 hours at :20 |
| `bipeur-standby.service` | workstation | the failover instance, tailnet only |

```bash
# reinstall a unit after an edit
scp ~/.config/systemd/user/bipeur-backup.timer baptiste@100.124.18.48:~/.config/systemd/user/
ssh baptiste@100.124.18.48 'systemctl --user daemon-reload && systemctl --user restart bipeur-backup.timer'
```
