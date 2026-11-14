# The closing page — the loop the approval used to leave open

An approval used to be the end of the story. The agent got its green light and
vanished: nobody knew what it did with it, and the human who approved a
four-line summary had no way to check the outcome. "I approved a push" and "a
push happened" are two facts, and Beeper only knew the first.

A **closure** is the other half of the loop. The agent proves what it did, the
pager of the person who decided learns the result, and the proof is journalled
against the page it closes.

```
agent ──▶ POST /v1/pages  ──▶ Central ──▶ pager:  310 a PUSH main>origin #07c2
                                              │
                                         human decides (signed)
                                              │
        ◀────────────────────── decision ─────┘
        │
        └──▶ does the work
              │
              ▼
        POST /v1/closures { page_id, summary, evidence }
              │
              ▼
        Central: page decided? approved? not closed yet? ──▶ 810 a DONE commit 1a2b3c4 #9f2e
                                              │
                                              ▼
                                        the SAME pager rings again
```

## What is composed, and what is quoted

The honesty rule does not pause for receipts. The line of a closing page is
composed from the **evidence** — a commit sha, a PR number, a file list — and
the agent's own words land on the last detail screen, behind `AGENT SAYS:`:

```
810 a DONE commit 1a2b3c4 PR #87 #9f2e
DIFF: …
AGENT SAYS: trois commits poussés, CI verte, rien d'autre touché
```

You decide on the fact, and you read the narrative as the narrative. An agent
that sends `summary` without `evidence` gets a receipt that says `closed
#07c2` — visibly thin, and that is the point: **a closure you cannot verify is
a closure that looks like one.**

## Three deliberate differences

| | an approval page | a closing page |
|---|---|---|
| asks | a decision | nothing |
| options / callback | seeded replies, `callback_url` | none, none |
| lifetime | the rules' TTL | one hour, then it expires **inert** |
| attention budget | charged (green/amber) | **never charged** |
| who sees it | the rota's on-call | the pager that decided, alone |

The exemption from the budget is what makes the loop close: if a receipt were
charged, a busy hour would hold the *proofs* behind the *questions* — the one
thing an operator wants to read would be the last thing to arrive.

Because family 8 is exempt, **a source cannot claim it**: `POST /v1/pages` with
`code: 8xx` is refused with `reserved_code_family`. Only the closure path writes
an 8xx page, and only against a page the same station paged. Without that lock,
declaring a code would be an unlimited pass on your attention.

## The four refusals

A closure is a claim, and a claim can be wrong. Each case is a different answer,
and each is journalled as `closure.rejected`:

| Case | Status | Why it is not a silent no-op |
|---|---|---|
| page never decided | 409 `not_decided` | an agent cannot close a page it only asked for |
| page denied | 409 `denied_page` | a refusal is not an authorisation to proceed |
| page of another station | 404 `unknown_page` | you cannot close what you cannot see |
| page already closed | 200, the first receipt | a retry is not a second closure |

The last row is the important one: `closures.page_id` is the **primary key**, so
one page has one closure at the database level, not by convention. A retried
request lands on the receipt that already exists and never overwrites it — an
agent cannot rewrite its own proof by retrying harder.

## On the wire

```bash
# The agent closes what it was approved to do.
curl -s -X POST -H "authorization: Bearer $STATION" https://…/v1/closures \
  -d '{"page_id":"pg_…","summary":"trois commits poussés","evidence":"commit 1a2b3c4 PR #87"}'
# → {"page_id":…,"closure_page_id":"pg_…","origin_fingerprint":"07c2…",
#    "closed_at":1763121600000,"page":{… the 810 line …}}

# The human reads the receipt of a page they approved.
curl -s -H "authorization: Bearer $STATION" https://…/v1/pages/pg_…/closure
```

`origin_fingerprint` ties the receipt to the exact payload that was displayed:
the closure's own fingerprint covers the page id **and** the origin fingerprint,
so a receipt cannot be detached from what it closes and re-attached somewhere
else.

## What it is not

Not an execution log, not a stdout. The evidence is one verifiable handle —
something you can go look at — not a paste of 400 lines. Not an attestation
either: the Central records what the station *says* it did; proving what
*happened* would need the runner to sign its own output, which is a different
feature on a different trust root. What it does is make silence impossible:
after this, an approved page that never reports back is visibly, audibly,
permanently unanswered.
