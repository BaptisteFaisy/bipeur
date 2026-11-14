# The diff on the page — you approve a change, not a command

The deepest hole in an approval tool is this: the human sees a *command* and
signs a *change*. `git push origin main` says nothing about the four lines that
move. Beeper closes the hole (BIP-F-40) by putting the diff on the pager — and
by covering it with the fingerprint, so what you signed is exactly what shipped.

```
agent ──▶ POST /v1/pages { kind: "tool", command, diff }
                          │
                          ▼
        Central: factsOf() ──▶ SHA-256 ──▶ fingerprint  #a3f9
                          │
                          ▼
        screens: le fait ─▶ le DIFF ─▶ "AGENT SAYS:"
                          │
                          ▼
        pager: 4 × 20, ▼ for the next screen, signed decision
```

## The order is fixed

Facts first, then the diff, then the agent's own words — never the other way
round. The honesty rule (A.6) already kept the prose off the line; the diff is
treated the same way, because it is a **fact the agent chose**, not a
description the agent wrote.

```
110 fw RUN pnpm build #7c1e
DIFF: +120 -14 in 3 files --- a/lib/date.ts +++ b/lib/date.ts
DIFF: -import dayjs from "dayjs"; +import { DateTime } from "luxon";
AGENT SAYS: totally safe, nothing to see here
```

Every diff screen carries the `DIFF:` label. A human scrolling with `▼` always
knows whether they are reading the change or the pitch.

## Whole lines, never half a line

A 4 × 20 LCD is read by eye in one second. A diff line split across two rows is
unreadable, so the screens are packed with **whole lines** (74 characters per
screen, `DIFF: ` included), and a line longer than that is cut with `~`.

What does not fit is **said**, not dropped:

```
DIFF: +400 -12 in 9 files @@ -1,3 +1,4 @@ +const a = 1 +const b = 2~ +397 more lines
```

The ceiling is six screens for the diff, so the agent's prose and the other
facts are never starved. The total stays inside the twelve screens a page may
carry (BIP-F-16).

## The fingerprint covers the diff

`diff` is part of `factsOf()`, so it is part of the SHA-256 the pager signs.
Three consequences, all tested:

- a decision signed on one diff **cannot** be applied to another;
- an agent that edits the diff after the page was sent gets a
  `fingerprint_mismatch` — the page it is answering is not the page it saw;
- the audit log carries the fingerprint, never the diff: the diff is the
  payload, and the payload stays out of the append-only log (BIP-N-03).

## On the wire

`diff` is a string of at most 20 000 characters on a `tool` page. It is
optional: a page without a diff composes exactly as before, so every existing
source keeps working.

```json
{
  "kind": "tool",
  "tool_name": "shell",
  "command": "pnpm build",
  "diff": "--- a/lib/date.ts\n+++ b/lib/date.ts\n- import dayjs\n+ luxon\n"
}
```

## What it is not

Not a code-review tool. The pager shows you *that* the change is what you
expected and *how big* it is; the review stays where reviews happen. A red page
with a 4 000-line diff is a refusal, and that is the correct outcome: the
budget of human attention is the scarce resource, and this feature spends it on
the fact rather than on the narrative.
