#!/usr/bin/env python3
"""External uptime probe of the public Beeper instance (stdlib only).

Why this exists: the watchdog that runs on the r630 can only see its own host.
If the host dies, loses its network, or Tailscale stops serving the Funnel,
nothing notices and the public URL stays dead in silence. This probe is run by
`.github/workflows/uptime.yml` from a GitHub runner and appends one JSON line
per sample to a history file, so availability is a measured number rather than
a promise.

The tailnet trap (measured 2026-11-11): the runner host sits on the same
tailnet as the instance, so `r630-debian.tail3a8bdf.ts.net` resolves to its
100.x address through MagicDNS. A naive request would then prove the *tailnet*
path and never the public one. This probe pins DNS onto a Funnel edge address
discovered from a public resolver (1.1.1.1, then 8.8.8.8, then DNS-over-HTTPS),
which forces the request out to the internet exactly like a judge's browser.
Both paths are measured and labelled, so a red edge sample next to a green
tailnet sample means "Funnel edge", not "the Central is down".

Exit code: 0 when the public path answered correctly, 1 otherwise, so the
workflow run turns red on its own.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import socket
import ssl
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

DEFAULT_URL = "https://r630-debian.tail3a8bdf.ts.net"
DOH_RESOLVERS = (
    "https://cloudflare-dns.com/dns-query?name={host}&type=A",
    "https://dns.google/resolve?name={host}&type=A",
)
# Markers of the real pager page. An error page (Funnel 502, Tailscale "server
# not running", a reverse-proxy default page) never carries all of them.
ROOT_MARKERS = ("<title>Beeper</title>", "/assets/", "manifest.webmanifest")
UA = "bipeur-uptime-probe/1.0 (+https://github.com/BaptisteFaisy/bipeur)"


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def dig_a_records(host: str, resolver: str) -> list[str]:
    """Ask one public resolver for the A records of `host` (empty on failure)."""
    try:
        out = subprocess.run(
            ["dig", "+short", "+time=5", "+tries=1", f"@{resolver}", host, "A"],
            capture_output=True, timeout=15, check=False,
        ).stdout.decode("utf-8", "replace")
    except (OSError, subprocess.SubprocessError):
        return []
    return [line.strip() for line in out.splitlines() if re.fullmatch(r"\d+\.\d+\.\d+\.\d+", line.strip())]


def doh_a_records(host: str) -> list[str]:
    """DNS-over-HTTPS fallback for hosts without `dig` (stdlib urllib only)."""
    for template in DOH_RESOLVERS:
        request = urllib.request.Request(
            template.format(host=host), headers={"Accept": "application/dns-json", "User-Agent": UA}
        )
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                payload = json.loads(response.read().decode("utf-8", "replace"))
        except (OSError, ValueError, ssl.SSLError):
            continue
        records = [a.get("data", "") for a in payload.get("Answer", []) if a.get("type") == 1]
        if records:
            return records
    return []


def public_edge_ips(host: str) -> tuple[list[str], str]:
    """Return the Funnel edge addresses of `host` and how they were found."""
    for resolver in ("1.1.1.1", "8.8.8.8"):
        records = dig_a_records(host, resolver)
        if records:
            return records, f"dig@{resolver}"
    records = doh_a_records(host)
    return records, ("doh" if records else "none")


def pin_dns(host: str, ip: str) -> None:
    """Make every lookup of `host` in this process answer `ip`.

    The connection still uses the real hostname for SNI and certificate
    validation, so TLS behaves exactly as it does for a visitor.
    """
    real_getaddrinfo = socket.getaddrinfo

    def pinned(target, *args, **kwargs):
        return real_getaddrinfo(ip if target == host else target, *args, **kwargs)

    socket.getaddrinfo = pinned


def fetch(url: str, timeout: float) -> dict:
    """GET `url`; never raises. Returns code, latency_ms, bytes, error, body."""
    started = time.monotonic()
    request = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read(65536)
            return {
                "code": response.status,
                "latency_ms": round((time.monotonic() - started) * 1000),
                "bytes": len(body),
                "body": body.decode("utf-8", "replace")[:4096],
                "error": "",
            }
    except urllib.error.HTTPError as exc:  # an answer, just not a good one
        return {
            "code": exc.code,
            "latency_ms": round((time.monotonic() - started) * 1000),
            "bytes": 0, "body": "", "error": f"http {exc.code}",
        }
    except (OSError, ssl.SSLError, ValueError) as exc:
        return {
            "code": 0,
            "latency_ms": round((time.monotonic() - started) * 1000),
            "bytes": 0, "body": "", "error": f"{type(exc).__name__}: {exc}"[:200],
        }


def judge_healthz(result: dict) -> dict:
    """`/healthz` is good on HTTP 200 with a JSON body saying ok:true."""
    verdict = dict(result)
    verdict.pop("body", None)
    ok = result["code"] == 200
    if ok:
        try:
            ok = json.loads(result["body"]).get("ok") is True
        except ValueError:
            ok = False
    verdict["ok"] = ok
    return verdict


def judge_root(result: dict) -> dict:
    """`/` is good on HTTP 200 with every marker of the real pager page."""
    verdict = dict(result)
    verdict.pop("body", None)
    missing = [marker for marker in ROOT_MARKERS if marker not in result["body"]]
    verdict["ok"] = result["code"] == 200 and not missing
    if missing:
        verdict["missing_markers"] = missing
    return verdict


def probe_path(url: str, path: str, timeout: float, host: str, edge_ip: str | None) -> dict:
    """Probe /healthz and / once, over the pinned edge IP or the default DNS."""
    if edge_ip:
        pin_dns(host, edge_ip)
    healthz = judge_healthz(fetch(f"{url}/healthz", timeout))
    root = judge_root(fetch(f"{url}/", timeout))
    return {
        "path": path,
        "edge_ip": edge_ip or "",
        "healthz": healthz,
        "root": root,
        "healthy": bool(healthz["ok"] and root["ok"]),
    }


def build_sample(args: argparse.Namespace, host: str) -> dict:
    """Run every configured path and assemble one history sample."""
    edges, source = ([args.edge_ip], "cli") if args.edge_ip else public_edge_ips(host)
    sample = {
        "ts": now_iso(),
        "host": host,
        "vantage": args.vantage,
        "edge_source": source,
        "edge_ips": edges,
        "timeout_s": args.timeout,
        "paths": [],
    }
    if edges:
        sample["paths"].append(probe_path(args.url, "funnel-edge", args.timeout, host, edges[0]))
    if not args.edge_only:
        sample["paths"].append(probe_path(args.url, "default-dns", args.timeout, host, None))
    return sample


def verdict(sample: dict) -> tuple[bool, list[str]]:
    """The instance is up when the public path answered (edge, else default)."""
    problems: list[str] = []
    for path in sample["paths"]:
        for name in ("healthz", "root"):
            check = path[name]
            if check["ok"]:
                continue
            reason = check.get("error") or (
                f"missing {check['missing_markers']}" if check.get("missing_markers") else "unexpected body"
            )
            problems.append(f"{path['path']}/{name}: code {check['code']} — {reason}")
    public = next((p for p in sample["paths"] if p["path"] == "funnel-edge"), None)
    decided = public or (sample["paths"][0] if sample["paths"] else None)
    return (bool(decided and decided["healthy"]), problems)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--url", default=os.environ.get("BIPEUR_PUBLIC_URL", DEFAULT_URL))
    parser.add_argument("--vantage", default=os.environ.get("BIPEUR_VANTAGE", "local"))
    parser.add_argument("--timeout", type=float, default=20.0)
    parser.add_argument("--edge-ip", default="", help="pin this Funnel edge address (skip discovery)")
    parser.add_argument("--edge-only", action="store_true", help="skip the default-DNS path")
    parser.add_argument("--jsonl", default="", help="append the sample to this JSONL history file")
    args = parser.parse_args()

    host = re.sub(r"^https?://", "", args.url).split("/")[0].split(":")[0]
    sample = build_sample(args, host)
    healthy, problems = verdict(sample)
    sample["healthy"] = healthy
    line = json.dumps(sample, separators=(",", ":"), sort_keys=True)
    print(line)
    if args.jsonl:
        os.makedirs(os.path.dirname(os.path.abspath(args.jsonl)) or ".", exist_ok=True)
        with open(args.jsonl, "a", encoding="utf-8") as handle:
            handle.write(line + "\n")
    for problem in problems:
        print(f"::error::uptime {problem}", file=sys.stderr)
    return 0 if healthy else 1


if __name__ == "__main__":
    sys.exit(main())
