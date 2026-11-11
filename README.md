# Uptime history of the public Beeper instance

One branch, two files, no code. `.github/workflows/uptime.yml` appends one JSON
line per probe to `uptime-history.jsonl` every ten minutes, from a GitHub
runner, over the internet (DNS pinned onto a Tailscale Funnel edge address, so
the request cannot silently take the tailnet path).

This branch exists because `main` is protected (required status checks, linear
history, enforce_admins): a cron probe can never commit there, and opening a pull
request every ten minutes is not a monitoring system. Pushing here triggers no
workflow — every trigger in this repository is `pull_request` or
`push: branches: [main]`.

Read the numbers with:

```bash
python3 tools/ops/availability.py --jsonl uptime-history.jsonl --markdown
```

Sample fields: `ts`, `vantage`, `edge_ips`, and one entry per `path`
(`funnel-edge` = the public path, `default-dns` = whatever the runner's resolver
answered), each with the HTTP code, the latency in ms and the verdict of
`/healthz` and `/`. `healthy` is the verdict of the public path.
