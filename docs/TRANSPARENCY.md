# Transparency — a journal a root cannot quietly rewrite

The audit log is append-only. Inside our SQLite file, with a trigger that
refuses `UPDATE`. That stops accidents. It does not stop whoever holds root on
this machine — and "trust us, the log is intact" is exactly the sentence an
audit exists to make unnecessary.

BIP-F-45 folds the journal into a **Merkle root** and publishes it *outside the
database*. Once a root has left the machine, rewriting an event changes the
root, and the lie is visible to anyone with the anchor — no access to this
server required.

```
events (append order, row ids)
   │  leaf = H("L" + canonical({id, ts, type, page_id, source_id, device_id, fingerprint, data}))
   ▼
  L1  L2  L3  L4  L5  L6  L7
   └─┬─┘  └─┬─┘  └─┬─┘   │
    N1      N2     N3    │        unpaired node is PROMOTED, never duplicated
   └───┬────┘   └───┬────┘        (duplicating would give two different logs
       N4          N5             the same root)
   └───────┬────────┘
          ROOT  ──▶ GET /v1/transparency/root
                 ──▶ data/transparency-anchor.txt   (outside the DB)
```

## What is committed

Both the **content** and the **position** of every event. The leaf carries the
row `id`, because the journal is a sequence, not a set (BIP-F-12). So all four
tampering shapes move the root:

| Tampering | Caught because |
|---|---|
| edit one event | its leaf changes |
| delete one event | every later leaf shifts position |
| insert an event | same, plus the count changes |
| swap two events | two leaves land on two positions |

The layout is named, `bipeur-merkle-v1`, and travels with every proof: a
verifier must know which tree to rebuild.

## The three endpoints

```bash
# 1. The root over the journal as it stands. Public on purpose: a public claim
#    needs a public check.
curl -s https://…/v1/transparency/root
# → {"algorithm":"bipeur-merkle-v1","root":"9f…","events":412,"last_id":412}

# 2. The inclusion path of one event. An outsider folds it back onto the root.
curl -s "https://…/v1/transparency/proof?event_id=97"
# → {"algorithm":…,"root":"9f…","proof":{"leaf":"{\"id\":97,…}","index":96,
#    "total":412,"path":[{"position":"right","hash":"…"},…]},"event":{…}}

# 3. Publish the root now: appends `transparency.checkpoint` and anchors it.
#    Authenticated — publishing is an operator act.
curl -s -X POST -H "authorization: Bearer $TOKEN" https://…/v1/transparency/checkpoint
```

Verification, from the outside, is thirty lines and no database:

```python
leaf = H("L" + canonical(proof.leaf))          # the leaf the endpoint returned
for step in proof.path:                        # fold the path up
    leaf = H("N" + step.hash + leaf) if step.position == "left" else H("N" + leaf + step.hash)
assert leaf == published_root                  # the root from the ANCHOR, not from us
```

Compare against the anchor, never against `/v1/transparency/root`: the server
that is lying would hand you the root that makes the lie check out.

## The anchor

`BIPEUR_ANCHOR_PATH` (unset by default). One line per published root,
append-only, plain text:

```
1763121600000 9f4c… 412 412
1763125200000 a71e… 514 514
```

`ts root events last_id` — enough to verify a proof, nothing that leaks a
payload (BIP-N-03). Copy it anywhere that outlives this machine: a git commit
in the deployment repo, a CI artifact, a second host. **An anchor that stays on
this disk proves nothing**: whoever rewrote the log would rewrite the file too.
Without the variable, the root is still computed and served, but nothing leaves
the database, and no outsider could catch a rewrite — the honest default is to
set it.

## When a root is published

Every hundred events, on the maintenance pass. The baseline is read back from
the last `transparency.checkpoint` record — how many events *it* committed to —
not from `count % 100`, which would fire on a multiple and miss every other
growth. A checkpoint commits to the journal **as it was before** the checkpoint
event itself, so the act of anchoring can never hide the anchor.

Retention (BIP-F-08) prunes events older than `BIPEUR_RETENTION_DAYS`. Pruning
moves the root: the anchor keeps the history, so an old proof still checks
against the old root. Pruning is a policy, not a rewrite — and it is itself an
audited event.

## What it is not

Not a public ledger, not a blockchain, not a notary service. Nobody is charged,
nothing is broadcast, and no third party must cooperate. It is one hash per
hundred events, written where the operator cannot quietly un-write it — enough
for a customer, an auditor or a judge to check, years later, that the pages they
were told about are the pages that were logged.
