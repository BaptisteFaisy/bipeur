# The rota — who answers when nobody is you

Beeper pages **one** human. That is the whole point. But a fleet of agents
pages at any hour, and one human cannot be awake at three in the morning. The
rota (BIP-F-37) is how a page finds the right person, in the right order,
without losing the 1995 promise: one line, one tap, and a refusal if nobody
answers.

```
you ──▶ agent pages the rota "night"
               │
               ▼
        who holds the pager now?
               │
        ┌──────┴──────┐
        ▼             ▼
     Alice          (nobody forgot her)
     rings          escalate_after_ms
                       │
                       ▼
                     Bob rings
                       │
                       ▼
                 nobody left → the page expires (a refusal)
```

## The three parts

- **The rota** — a label (`night`, `weekend`, `incident`) and a window:
  how long the current on-call has before the page moves on
  (`escalate_after_ms`), and optionally an automatic `rotation_ms`.
- **The shifts** — an ordered list of humans. A shift names a human (`alias`)
  and the pager that rings for them (`target`, a device id). Order is the
  escalation order; a shift may also carry an explicit time window.
- **The target** — which device a page is addressed to *right now*. A page sent
  to a rota lands on the on-call device **only** — not on every pager of every
  operator. When it escalates, the address moves with it.

## Build a rota

Pair the pagers first (`GET /v1/devices` lists the ids). Then:

```bash
# 1. the rota — 2 minutes per on-call before it escalates
curl -X POST https://central/v1/rotas -H "Authorization: Bearer $TOKEN" \
  -d '{"label":"night","escalate_after_seconds":120}'
# → { "rota_id": "rt_…", "label": "night", … }

# 2. the on-call humans, in escalation order (priority defaults to the end)
curl -X POST https://central/v1/rotas/rt_…/shifts -H "Authorization: Bearer $TOKEN" \
  -d '{"alias":"alice","target":"dev_alice"}'
curl -X POST https://central/v1/rotas/rt_…/shifts -H "Authorization: Bearer $TOKEN" \
  -d '{"alias":"bob","target":"dev_bob"}'
```

## Page the rota

Any page request may name a rota. `POST /page` keeps its one-line simplicity:

```bash
curl -X POST https://central/page -H "Authorization: Bearer $TOKEN" \
  -d '{"message":"release 1.2.0 blocked on push","priority":"critical","rota":"night"}'
```

or the full shape on `POST /v1/pages` with `"rota":"night"`. If the label is
unknown, or nobody is on call, the answer is `422` — an agent never pages into
the void.

## What decided who holds the pager

Three rules, in order:

1. **A window** — a shift whose `starts_at`/`ends_at` contains the moment
   (a day shift 07:00–22:00, a night shift 22:00–07:00).
2. **A rotation** — with `rotation_ms` set, the pager changes hands every N
   milliseconds, in list order, from the rota's creation.
3. **The list** — otherwise the first shift is on call, and the whole rota is
   the escalation order.

## Escalation is a move, not a state change

When the window runs out, the page **stays `delivered`** — it simply moves to
the next device:

- the new on-call's pager rings (`page.delivered`);
- the previous one is told the page moved on (`page.escalated`) and drops it;
- the audit log records `page.escalated` with `from`, `to`, `level` and
  `after_ms` — who had it, who took it, and how long they had.

There is **no wrap**: Alice, then Bob, then the page expires unanswered — a
refusal, exactly like every other page nobody answers (BIP-F-07). An agent
never gets a silent "maybe" from an exhausted rota.

## Revoke in one gesture

```bash
curl -X DELETE https://central/v1/rotas/rt_…      # removes the rota and its shifts
curl -X DELETE https://central/v1/rotas/rt_…/shifts/sh_…   # one shift
```

Both write `rota.changed` to the audit log. Nothing is ever edited in place:
a rota is a sequence of written facts.