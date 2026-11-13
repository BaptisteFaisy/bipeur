# central-dashboard — design (Quick Spec)

## 1. Three screens, one query layer

```
GET /v1/audit?station=&code=&risk=&state=&since=      ──▶ History
GET /v1/metrics                                       ──▶ Indicators
POST /v1/rules/dry-run                                ──▶ Rules bench
GET  /v1/demo/start, GET /v1/demo/space/{id}           ──▶ Simulator
```

`src/dashboard/queries.ts` holds one SQL query per metric, each returning a
number and the rows it came from: an indicator the human cannot drill into is a
number nobody trusts. `src/dashboard/render.ts` is pure (rows → HTML strings), so
the view is testable without a browser.

## 2. Metrics, all derived from `events`

| Metric | Query shape |
|---|---|
| Decision latency | median of `page.decided.latency_ms` over the window, active hours only |
| Filter rate | `1 − count(page.created) / count(source events seen)` |
| Delivery p95 | p95 of `page.delivered.ts − page.created.ts` |
| Unblocked time | sum of the waits a source endured (`page.decided.ts − page.created.ts`) |
| Orphan approvals | count of accepted decisions whose fingerprint ≠ page fingerprint — **must be 0** |

The orphan-approval counter is displayed even though it is structurally zero: a
metric that can only be zero is worth showing once.

## 3. The simulator

`src/demo/simulator.ts` plays a scripted cast (`fw`, `a`, `b`) with jittered
timing: a `git push`, a destructive `rm -rf`, a design question, a budget warning,
a stuck agent. Each visitor gets a `space_id`; the store partitions pages by
space, and a scheduled job deletes spaces older than 24 h. The simulator writes
through the same `POST /v1/pages` path as a real source, so the demo exercises
the real code — no special case in the pipeline.

## 4. Rules bench

`dry-run` runs `classify()` and `composeLine()` from `packages/core` and returns
the result plus the name of the matched rule. It writes no page and no event.
This is the cheapest debugging tool of the whole product: a misclassified
command is found by pasting it, not by reading YAML.

## 5. Decisions and their reasons

1. **Server-rendered strings, no SPA.** The dashboard must load on a projector
   over a flaky venue network; a page of HTML is 20 KB and cannot fail to boot.
2. **The demo goes through the real API.** A demo with its own shortcut would
   show something the product does not do.
3. **Nothing is stored in the browser.** The dashboard holds no state; refresh
   is always safe.

## 6. Tests

`queries.test.ts` — each metric against a fixture audit log with known numbers.
`dry-run.test.ts` — a pasted command yields the documented line, no page created.
`simulator.test.ts` — two spaces stay isolated; the 24 h sweep deletes only old
spaces.
