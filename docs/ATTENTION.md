# The attention cost — the metric nobody has

"Six pages an hour" is a **limit**, not a measurement. It tells you when to
shut up; it never tells you what the silence bought. Beeper holds the one asset
no other agent tool has — a human who decides, on purpose, on a device that does
nothing else — and it is the only asset nobody prices. This is the pricing.

```
page ──▶ created_at ──▶ delivered_at ──▶ read_at ──▶ decided_at
              │              │               │            │
              └── the wait ──┘               └─ the look ─┘
                                            (read − delivered)
                                                         └─ latency_ms ─┘
                                                            (the decision)
```

**The bill is `read_ms + decide_ms`**: how long a human waited to look, plus how
long they spent deciding. Nothing else counts. An agent's CPU minutes are
cheap; a human's are not, and this is the only place the distinction is made.

## What is measured

| Number | Meaning | Why it matters |
|---|---|---|
| `human_minutes` | The bill, in minutes | The only unit a manager reads |
| `denial_rate` | Denied over decided | A gate that never denies is decorature |
| `interruptions_per_hour` | Pages over the span of the samples | The real cost of noise |
| `decision_median_ms` | Median, never mean | One 89 s hesitation must not hide a 1 s habit |
| `read − decided` | Read and never answered | The pages you saw and dropped |
| per station | The same, broken down | Which agent is worth its attention |

## From the journal, never from a counter

Every figure is derived from the pages and decisions that already exist — one
SQL join, no parallel state. Three consequences, all tested:

- **nothing is counted twice**: the sum of the stations is the total, exactly;
- **nothing is invented**: a page nobody read contributes no reading time, a
  page undecided contributes no decision time;
- **the window ages with the clock**: advance the clock and the bill follows,
  because the window is a query, not a remembered number.

A dashboard that invents a figure is worse than none: it gets read as a
measurement.

## The two traps

**A mean lies.** Three decisions of 1 s, 2 s and 89 s have a mean of 30.5 s and
a median of 2 s. The habit is 2 s; the 89 s is one hesitation. The median is
reported, and the total stays visible separately (`decide_ms`), because both are
true and they answer different questions.

**A quiet week dilutes a busy hour.** Six pages in one minute, then seven days
of silence, average to well under one interruption per hour. So the rate is
measured over the **span of the samples**, not over the calendar: the six-in-a-
minute stay the fact that matters, and the silence does not launder them.

## On the wire

A dashboard is not something you scrape, so the bill is an endpoint:

```bash
curl -s -H "authorization: Bearer $TOKEN" "https://…/v1/metrics/attention?hours=24"
# → {"total":{…},"stations":[…],"series":[{"at":…,"pages":3,"human_ms":41000},…],
#    "window_hours":24}
```

`hours` is clamped to 1…168 (a week) and falls back to 24 on junk — the query
belongs to the caller, the budget belongs to the Central. Authenticated like
every other metric, and it carries no payload: the bill is made of timestamps
and verdicts, never of commands (BIP-N-03).

## On the dashboard

`/dashboard` → **Attention cost**. The total in minutes, the five numbers above,
a table of stations worst-bill-first, and a spark of one bar per hour. Empty
hours are drawn as empty bars: a gap is a fact, and a dashboard that hides it
reads as a busy product.

## What it is not

Not a leaderboard. The bill is per station because the question is "which agent
is worth its attention", not "which colleague is the noisiest" — and it is
self-hosted, so the numbers never leave your machine. Not a quota either: the
budget (BIP-F-09) decides what may ring; this decides what it cost you, so the
next budget is set from a measurement instead of from a guess.
