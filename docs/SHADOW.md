# Shadow mode — measure the interruption before you take it

Intercepting a human is the product. It is also the cost. Nobody can say what a
gate *would* have saved, because turning it on is the only way to find out — and
the first thing it finds out is on a Friday afternoon, in front of someone
trying to ship.

**Shadow mode** breaks that circle: intercept, display, **simulate** the
agreement, never block. Seven days of it in production and the score is a
measurement, not a promise. You are not selling an interruption any more, you
are selling a number.

```
agent ──▶ POST /v1/pages ──▶ Central
                              │
              ┌───────────────┴────────────────┐
              ▼                                ▼
        enforce (default)                 shadow (BIPEUR_SHADOW=1)
        compose → route → block           compose → route → SHOW
        wait for a signed decision        resolve: approved, SIMULATED
              │                                │
              ▼                                ▼
        the agent waits                  the agent goes, at once
                                         the pager still shows the page
                                         the log says `page.shadowed`
```

## Three rules, and they are the whole design

**A simulated verdict is never indistinguishable from a real one.** The wire
carries `simulated: true` next to the status; the audit carries
`page.shadowed`; and **no row ever enters the `decisions` table**. So the metrics
of A.3 — median decision time, unblocked time, filter rate — stay what a *human*
did, and a month of shadow does not quietly inflate them with six hundred
approvals nobody made. An adapter that ignores the flag and acts as if a person
had approved is no longer protected by anything, and the log says which verdict
it was handed.

**A page a human actually decides wins over the simulation, whenever it
arrives.** Shadow mode resolves the *wait*; it never mutes the *pager*. The page
is on the screen, it can be read, it can be decided for real, and the instant a
signed decision lands, `simulated` flips to `false` — because that verdict now
has a person behind it.

**The counters are read back from the journal, never accumulated in memory.** A
counter that dies with the process is not a measurement either. Restart the
Central and the score is what it was, because it *is* the log.

## What the score says

```bash
curl -s -H "authorization: Bearer $TOKEN" https://…/v1/shadow
# → {"enabled":true,"simulated":412,"would_have_held":37,
#    "would_have_been_denied":9,"really_decided":14}
```

| Number | Meaning | What you do with it |
|---|---|---|
| `simulated` | Pages that would have interrupted you | The volume of the gate |
| `would_have_held` | Pages a saturated budget would have held | The noise you were spared |
| `would_have_been_denied` | Pages the rules would have refused | The disasters avoided |
| `really_decided` | Pages a human decided anyway, during shadow | The ones that *needed* a person |

`would_have_*` is computed **before** the simulation, so it describes the world
where Beeper interrupts — not this one. That is the point of the exercise: you
are measuring the counterfactual, and the log keeps the two apart.

## Turning it on and off

```bash
# At boot:
BIPEUR_SHADOW=1 bipeur-central

# Live, without restarting:
curl -s -X PUT -H "authorization: Bearer $TOKEN" https://…/v1/shadow -d '{"enabled":true}'
```

The toggle is journalled as `shadow.toggled` — a **distinct** event type, not a
page. Who flipped it, and when, is part of the record: a mode that silently
changed in the middle of a week would make the score worthless.

Off is the default, and it stays the default. Measuring what an interruption
would cost must never be the reason an interruption goes missing.

## What it is not

Not a trial period, not a demo, not a way to soften the product. Shadow mode is
the deployment strategy of a gate: you do not hand someone a device that stops
their agents until you can show what it stopped. It is also the only honest
answer to the objection that kills this category of tool — *"what if it blocks
something important?"* — because the answer is a number from your own journal,
not a slide.

The pages are still composed, still routed, still shown. Nothing about the
product is simulated: only the agreement is.
