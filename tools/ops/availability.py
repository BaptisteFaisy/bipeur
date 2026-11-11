#!/usr/bin/env python3
"""Turn the uptime JSONL history into numbers a human can quote (stdlib only).

The history is written by `tools/ops/probe.py` (one JSON line per sample, one
sample per probe run). This summariser answers the only question that matters
for the contest: *what availability was actually measured, over what window?*

    python3 tools/ops/availability.py --jsonl uptime-history.jsonl
    python3 tools/ops/availability.py --jsonl uptime-history.jsonl --markdown
    python3 tools/ops/availability.py --jsonl uptime-history.jsonl --since-days 7

A sample counts as "up" when its public path (`funnel-edge`, the request pinned
onto a Tailscale edge address) answered 200 with `{"ok":true}` on /healthz and
with the real pager page on /. Samples that only have the `default-dns` path
(the runner sits on the tailnet, where MagicDNS answers the 100.x address) are
still counted, but reported separately: they prove the Central, not the Funnel.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone


def parse_ts(value: str) -> datetime | None:
    try:
        return datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    except (ValueError, TypeError):
        return None


def load_samples(path: str) -> list[dict]:
    """Read the JSONL history, skipping unreadable or malformed lines."""
    samples: list[dict] = []
    try:
        handle = open(path, encoding="utf-8")
    except OSError as exc:
        print(f"cannot read {path}: {exc}", file=sys.stderr)
        return samples
    with handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                sample = json.loads(line)
            except ValueError:
                continue
            if parse_ts(sample.get("ts", "")) and isinstance(sample.get("paths"), list):
                samples.append(sample)
    return samples


def public_path(sample: dict) -> dict | None:
    """The path that decides the verdict: the pinned edge, else the default DNS."""
    edge = next((p for p in sample["paths"] if p.get("path") == "funnel-edge"), None)
    return edge or (sample["paths"][0] if sample["paths"] else None)


def percentile(values: list[float], rank: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, round(rank / 100 * (len(ordered) - 1))))
    return float(ordered[index])


def failure_reason(path: dict, name: str) -> str:
    """Why a check that came back was still not good enough."""
    check = path.get(name, {})
    detail = check.get("error") or (
        f"missing markers {check['missing_markers']}" if check.get("missing_markers") else "unexpected body"
    )
    return f"{name} code {check.get('code', 0)} — {detail}"


def summarise(samples: list[dict]) -> dict:
    """Aggregate the samples into one report dict."""
    rows = [(parse_ts(s["ts"]), public_path(s), s) for s in samples]
    rows = [(ts, path, s) for ts, path, s in rows if path]
    if not rows:
        return {"samples": 0}
    ups = [r for r in rows if r[1].get("healthy")]
    downs = [r for r in rows if not r[1].get("healthy")]
    latencies = [r[1]["healthz"]["latency_ms"] for r in rows if r[1].get("healthz", {}).get("code") == 200]
    edge_samples = [r for r in rows if r[1].get("path") == "funnel-edge"]
    window_s = (rows[-1][0] - rows[0][0]).total_seconds()
    return {
        "samples": len(rows),
        "up": len(ups),
        "down": len(downs),
        "availability_pct": round(100 * len(ups) / len(rows), 3),
        "edge_samples": len(edge_samples),
        "window_start": rows[0][2]["ts"],
        "window_end": rows[-1][2]["ts"],
        "window_days": round(window_s / 86400, 3),
        "mean_interval_s": round(window_s / max(1, len(rows) - 1), 1),
        "latency_p50_ms": round(percentile(latencies, 50)),
        "latency_p95_ms": round(percentile(latencies, 95)),
        "latency_max_ms": round(max(latencies)) if latencies else 0,
        "longest_outage_samples": longest_run(downs, rows),
        "failures": [
            {"ts": ts.strftime("%Y-%m-%dT%H:%M:%SZ"), "reason": failure_reason(path, name)}
            for ts, path, _ in downs[:50]
            for name in ("healthz", "root")
            if not path.get(name, {}).get("ok", True)
        ],
    }


def longest_run(downs: list[tuple], rows: list[tuple]) -> int:
    """Length of the longest consecutive run of failed samples."""
    failed = {id(row[2]) for row in downs}
    best = current = 0
    for row in rows:
        current = current + 1 if id(row[2]) in failed else 0
        best = max(best, current)
    return best


def render_markdown(report: dict) -> str:
    """Human-readable status block, meant to be pasted in docs/OPERATIONS.md."""
    if not report.get("samples"):
        return "_No uptime sample recorded yet._"
    lines = [
        f"**Measured availability: {report['availability_pct']} %** over "
        f"{report['window_days']} days ({report['samples']} probes, "
        f"{report['up']} up / {report['down']} down).",
        "",
        f"- window: `{report['window_start']}` → `{report['window_end']}` "
        f"(one probe every {report['mean_interval_s']} s on average)",
        f"- public path (Funnel edge, DNS pinned): {report['edge_samples']} of "
        f"{report['samples']} samples",
        f"- `/healthz` latency: p50 {report['latency_p50_ms']} ms, "
        f"p95 {report['latency_p95_ms']} ms, max {report['latency_max_ms']} ms",
        f"- longest consecutive outage: {report['longest_outage_samples']} probe(s)",
    ]
    if report["failures"]:
        lines += ["", "Failed probes (first 50):", ""]
        lines += [f"- `{f['ts']}` — {f['reason']}" for f in report["failures"]]
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--jsonl", required=True)
    parser.add_argument("--since-days", type=float, default=0.0, help="only the last N days")
    parser.add_argument("--markdown", action="store_true", help="print a paste-ready status block")
    args = parser.parse_args()

    samples = load_samples(args.jsonl)
    if args.since_days > 0:
        cutoff = datetime.now(timezone.utc).timestamp() - args.since_days * 86400
        samples = [s for s in samples if parse_ts(s["ts"]).timestamp() >= cutoff]
    report = summarise(samples)
    if args.markdown:
        print(render_markdown(report))
    else:
        print(json.dumps(report, indent=2, sort_keys=True))
    return 0 if report.get("samples") else 1


if __name__ == "__main__":
    sys.exit(main())
