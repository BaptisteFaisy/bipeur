# Grouped pages — one event, one interruption, one signature

Three agents noticed the same thing at the same minute: `git push`, `gh release
create`, `terraform apply`. Without grouping, that is three beeps, three reads,
three decisions — three interruptions for **one** question: "do you want this
release out?". Noise is the enemy n°1 of a pager, and the shared attention
budget is the constraint n°1: grouping is what makes both survivable.

```
POST /v1/pages { command: "git push origin main",   group: "deploy-42" }  ──▶ rings
POST /v1/pages { command: "gh release create v1",   group: "deploy-42" }  ──▶ attached
POST /v1/pages { command: "terraform apply",        group: "deploy-42" }  ──▶ attached

        the pager shows ONE item:
        310 fw PUSH main>origin 3 commits +120-14 #a1b2
        GROUP 1/3: +2 linked pages in this block
        GROUP 2/3: 320 fw DEPLOY gh release create v1 #9c3d
        GROUP 3/3: 110 fw DELETE terraform apply #7f10
```

## The hard part is the signature, not the screen

BIP-F-18: *a decision can never apply to another page*. The naive way to group
is to propagate the leader's approval to its members — and that is precisely the
lie the fingerprint exists to prevent: you would be answering a payload you
never signed.

So the block is closed the other way round. When a member joins, the **leader's
fingerprint is recomputed over the whole block**:

```
digest = canonical({ v: 1, leader: <leader fingerprint>, members: [<each member fingerprint>] })
leader.payload_sha256 = sha256(digest)
```

The human reads the list on the leader's screens and signs the list. One
signature covers exactly what was displayed — nothing is inherited, nothing is
implied. The members are settled by that decision, and each member's audit
record says `via_group: <leader>`, so the journal never pretends a member was
signed individually.

## Two rules keep that honest

**A leader is re-signed only while it is pending and unread.** Once a human has
laid eyes on it, what they saw is fixed: the incoming page opens its own group
and rings. Rewriting a read page would move the ground under a decision already
in flight — and the whole product rests on *the line you see is the line you
sign*.

**No member is ever lost from the list.** The block is packed into screens with
the label reserved *before* packing (`GROUP 2/3:` is 13 characters taken out of
the 80, not bolted on after). A block that cannot fit in the ceiling is
**refused**, not truncated: it rings on its own. Signing an incomplete list
would be worse than two interruptions.

## What a block costs

A member never rings, so it never spends the attention budget: **the block is
one slot**, not three. The budget counts deliveries, and there is one delivery.

```
budget 6/h · 6 blocks delivered → the 7th ordinary page is HELD
                            ↘ but a member of an existing block still joins, free
```

That asymmetry is deliberate: holding a *new* question is protection; holding a
*member* of a question already on screen would split a block across the hour and
produce exactly the two-interruptions-for-one-decision this feature removes.

## The projection: what this page will cost

A page that costs 4 of the 6 remaining is a different decision from a page that
costs 1 of 6 — and the human must see it **before** tapping, not after.

```
BUDGET: this page costs 1 of 6 per hour — 4 left after it
BUDGET: this page costs 1 of 6 per hour — 6 already spent, it would be HELD
```

The note is written into the **stored** screens, so the replay of BIP-F-46 shows
what was on the LCD, projection included. It is added only when it changes
something: a free page (a receipt, a member, a red page) always says so, and an
ordinary page says so once the window is partly spent. On the first page of an
empty hour, "costs 1 of 6, 5 left" is noise — and noise is what this feature
exists to fight.

`GET /v1/metrics` carries `projection` for the *next* page, so the dashboard
draws the hour that comes and not only the hour that passed.

## On the wire

`group` is a fact on both kinds of page, so questions group too — the most
natural case ("two design choices, one answer"):

```json
{ "kind": "question", "question": "date lib?",     "group": "choix-date", "options": [...] }
{ "kind": "question", "question": "timezone lib?", "group": "choix-date", "options": [...] }
```

It is capped at 64 characters and enters the fingerprint, like the diff. The
queue a pager shows contains **leaders only**: a member is the same question,
listed, never a second item.

## What it is not

Not a workflow engine. A block is one human decision about pages that arrived
close together and share a key the *station* chose — it is not a sequence, not a
dependency graph, not a plan. If the pages must be decided separately, do not
group them.

Not a way to sign less, either. The signature covers *more* than before: the
whole block. Grouping removes interruptions, never scrutiny.
