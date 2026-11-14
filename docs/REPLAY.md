# The post-mortem replay — "show me the four lines I saw at 14:32"

The journal keeps the facts. It does not keep the **gesture**. Months later, in
front of a customer, an auditor or a judge, the question is never "what was in
the database?" — it is "what did the human actually see, and what did they
answer to that?". A recomposition cannot answer it: the rules have moved, the
translations have moved, and the payload may have aged out of retention.

Beeper answers it exactly, because the page row already stores what the pager
showed: the line, and the detail screens, in order.

```
GET /v1/pages/pg_9f2e/replay
{
  "page_id": "pg_9f2e",
  "line": "310 fw PUSH main>origin 3 commits +120-14 #07c2",
  "screens": [
    "git push origin main",
    "on main 3 commits +120-14",
    "AGENT SAYS: totally safe, nothing to see here"
  ],
  "code": 310, "risk": "amber", "state": "decided", "status": "approved",
  "fingerprint": "07c2…",
  "created_at": 1763035927000, "delivered_at": 1763035927400,
  "read_at": 1763035941000,
  "decided_at": 1763035952000, "verdict": "approve", "choice": null,
  "latency_ms": 11000,
  "truncated": false
}
```

## Retrieval, not composition

The replay never calls the composer. It reads `pages.line` and `pages.detail`
— the bytes written when the page was created — and the decision row for the
verdict. Three consequences, all tested:

- **changing the rules afterwards does not change the replay**. Today's Central
  would compose a different line for the same command; the replay still shows
  what was shown. A recomposition would be a claim about the present, and the
  dispute is about the past.
- **a cut line replays as cut, *and* complete**. The `truncated` flag comes from
  the `page.created` audit event — the fact as it was recorded, not a guess from
  a `~` that could be part of the text — and the full question is on the detail
  screens, exactly as the human scrolled to it.
- **a replay never invents the gesture**. No decision row, no verdict: `null`,
  not a guess. The `choice` letter and `latency_ms` come from the signed record.

## Text, for the person who has to read it

`?format=text` renders the same thing for a human, one physical line per
physical line:

```
BEEPER REPLAY pg_9f2e
STATE decided STATUS approved RISK amber
CREATED 1763035927000 DELIVERED 1763035927400 READ 1763035941000
DECIDED 1763035952000 VERDICT approve LATENCY 11000ms
TRUNCATED no FINGERPRINT 07c2…

[0/line] 310 fw PUSH main>origin 3 commits +120-14 #07c2
[1/detail] git push origin main
[2/detail] on main 3 commits +120-14
[3/detail] AGENT SAYS: totally safe, nothing to see here
```

`[0/line]` is the 4 × 20 screen; `[1..n/detail]` are the screens the `▼` key
walked through, in that order. The numbering is the pager's, so a transcript
reads like the device did.

## The replay is itself audited

Consulting a page is a fact worth keeping: every replay appends
`page.replayed`, with the page id, the fingerprint and the number of screens —
**never the line, never the screens** (BIP-N-03). So the record answers two
questions at once: what the human saw, and who looked at it afterwards.

That matters because a replay is a *claim about the past* made by the party
that holds the database. The audit says when the claim was produced; the
Merkle anchor of BIP-F-45 says it was produced from a journal that has not been
rewritten since.

## On the dashboard

`/dashboard` → **Post-mortem replay**: paste a page id, get the stored line and
the stored screens, in order, with the timestamps and the verdict. It is a
station route, authenticated, and it never leaves the browser.

## What it is not

Not a screenshot. The pager has no pixels to keep — it keeps the 80 characters
and the screens it was built from, which is the thing that was actually read.
Not a payload dump either: the replay shows what was **displayed**, and the
display is already the honest, fact-only composition (A.6). If the payload
itself is needed, that is the station's own business, and it is not in the
journal.
