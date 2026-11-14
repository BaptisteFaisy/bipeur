# The canary — an approval is not a reflex

A human who approves in 150 ms has signed, willingly, without reading. The
fingerprint is perfect, the ECDSA signature is valid, the audit is append-only
— and none of it matters: the one person who was supposed to say "stop" hit
"yes" without seeing the word it was attached to.

The canary asks the uncomfortable question that the rest of the system cannot
answer: **did a human read what they signed?**

```
three decisions of this device: 180 ms · 220 ms · 310 ms
                  │
                  ▼ median = 220 ms, under 1,500 ms
                  │
next page: CANARY — decided too fast lately
approve (tap) ──▶ refused, the key is waiting
approve (hold one second) ──▶ signed { verdict: approve, held_ms: 1,047, … }
```

## The habit, not the page

The measure belongs to the **device**, not to the risk of the page. A person
who taps every green question in 150 ms is not careful just because the next
page happens to be green; and a person who thinks for a full minute is not a
reflex risk because the next page is red.

What is measured is the median of the device's ten most recent decisions. The
median, not the mean: one long hesitation must not launder a habit of reflexes,
and one reflex must not condemn a careful person. The first two decisions do
not make a habit — fewer than three samples, no canary. Under three decisions
per device, the system has no evidence; it must say that, not guess.

A rota page is judged on **the device it actually rings**. A page to a whole
station is judged on that station's live pagers; if any one of them has become
reflexive, the page is a canary. The Central does not know which human will
pick up the pager, so the safe direction is deliberate: a one-second hold on a
careful person who shares a station with a reflexive one, rather than a
reflexive person who taps through on the second pager. Demo visitors are
isolated by their `visitor_id` (BIP-F-31): one judge's habit can never turn
another judge's page into a canary.

The window is ten decisions, so the habit can change. The guard is not a
sentence for a bad Tuesday; it is a measurement of a current pattern. There is
no manual "reset" button — only decisions whose median goes up. If the habit
improves, the next page is ordinary again; if it does not, the canary keeps
saying so.

## The deliberate gesture is part of the signature

A canary is a **fact on the page**, stored in the database and carried on the
wire. The pager does not infer it from the risk, and the Central does not ask
the browser nicely. The pager changes the key: a tap no longer does anything;
`Enter`, `Escape` and the on-screen `✔`/`✖` all require the same one-second
press-and-hold. The LCD itself explains why, before the gesture:

```
CANARY — decided too fast lately (220 ms median, under 1500)
```

What the pager measured, the Central verifies: `held_ms` is in the ECDSA
signature, so a client cannot send a tap and add `held_ms: 1000` afterwards.
Less than 1,000 ms is refused (`canary_needs_hold`), `held_ms` changed after the
signature is refused (`bad_signature`), and the fact is journalled with the
page fingerprint. A modified client could still lie about its own clock when
it signs — a browser cannot prove that a thumb was physically on glass — but
the lie is bound to a cryptographic claim the operator can inspect; it is no
longer an invisible one-tap path through the gate.

Seeded choices A–D are hidden on a canary: they are one-tap decisions, so
leaving them on-screen would create an escape hatch from the hold. The choices
remain on the detail page as facts; the operator explicitly approves or
refuses, after holding.

## The gesture lifts its own guard

A deliberate answer costs at least one second. Its latency is recorded in
`decisions.latency_ms` by the same path as every other signed decision — there
is no second counter, and there is no reset. The next time the median is
computed, that deliberate response joins the window. A guard that has to be
told to forget is a guard that can be told to forget; the measurement has to
move because the behaviour moved.

A median is *sticky*: one deliberate hold does not erase two hundred
one-tap approvals, and it must not. It lifts gradually as the deliberate
decisions replace the reflexes. The policy is the same in either direction:
**the next page is a canary exactly when the last ten signed decisions still
have a median under 1,500 ms.**

## Why this number, and what it cannot prove

1,500 ms is a **starting threshold**, not a law of attention. It is exposed in
the pure contract (`REFLEX_THRESHOLD_MS`) and the algorithm is tested over the
boundary; a deployment can pick another threshold without changing the rule.
The testable fact is not "someone reads in 1,500 ms" — nobody knows that. The
testable fact is "the reader of this device has lately signed more quickly
than this." It is a **proxy for rubber-stamping**, not an eye tracker, not a
pupil sensor, not a claim that the person read each word. The label on the
page says the proxy, and the ledger says the time.

A 20 × 4 pager is the one environment in which not reading is legible:
one tap on the one button that never moves. On the phone, the same one-second
hold is the smallest friction that proves an *intention to decide*, and it
costs less than a fake second-factor that nobody checks.

## What it is not

Not a sanction, not a reputation score, not a judgement about the person. The
page does not say "you are a bad approver". It says: *your last decisions on
this device were fast enough that your next one needs a deliberate gesture*.
It does not block the agent — it blocks the reflex. The human can always press
and hold, and the agent still waits for the exact ECDSA-signed decision it was
waiting for.
