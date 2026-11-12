# The unit channel — the pager side of the SNPP gateway

`bip-pager` is the device the SNPP gateway delivers to: a pager of 1995 in a
4x20 LCD terminal window. It speaks the **unit channel** of RFC 1861 (the half
that receives) and signs its decisions for the Central, exactly like the PWA.

```bash
pnpm --filter @bipeur/pager-emu build
node packages/pager-emu/dist/bin.js --port 4440 --capcode lea --code ABC123
```

## The frames

Unit to gateway, one line per frame, CRLF terminated:

| Frame | Meaning |
|---|---|
| `UNIT <capcode>` | register this connection as the unit of a capcode |
| `MCR <code>` | answer the page on the screen (`0001` … `0004`) |
| `QUIT` | hang up |

Gateway to unit:

| Frame | Meaning |
|---|---|
| `220 SNPP (V3) Gateway Ready` | the greeting; the emulator registers itself on it |
| `250 OK, Unit Registered` | the registration is accepted |
| `250 OK, Response Accepted` | the answer is on its way |
| `550 ERROR, Invalid Pager ID` | the capcode is malformed |
| `550 ERROR, Unit Already Registered` | another connection holds the capcode |
| `550 ERROR, No Message Awaiting Reply` | there is nothing to answer |
| `780 MESSAGE EXPIRED Before Delivery!` | the page expired before the answer |
| `MESS <line>` | the line of the page (80 characters at most) |
| `MCRE <code> <label>` | one seeded reply; `0001` is A, `0002` B, `0003` C, `0004` D |
| `SEND <tag> <secret>` | the delivery |
| `PAGE <page_id> [<fingerprint>]` | **proposed**, see below |

A session, as the gateway and the emulator really speak it:

```
S: 220 SNPP (V3) Gateway Ready
C: UNIT lea
S: 250 OK, Unit Registered
S: MESS 310 fw PUSH main>origin 3 commits +120-14 #07c2
S: MCRE 0001 Approve
S: MCRE 0002 Deny
S: SEND 4821 7730
C: MCR 0001
S: 250 OK, Response Accepted
C: QUIT
S: 221 OK, Goodbye
```

## The `PAGE` frame — what the gateway has to add

The Central decides the page: the decision is signed with the key of the
device and the Central verifies it (BIP-F-18). The claims of a decision carry
the **`page_id`** and the **`fingerprint`** of the page (BIP-P-05), and the
gateway is the only one that knows both: it creates the page on the Central.

So the gateway has to push one more frame to the unit, **before** `MESS`:

```
PAGE <page_id> [<fingerprint>]
```

- `page_id` is the id the Central returned when the page was created
  (`page_id` of `POST /v1/pages`);
- `fingerprint` is the 64 hex characters of `payload_sha256`, the very value
  the Central compares. It is **optional**: when the gateway does not push it,
  the emulator reads it from the Central (`GET /v1/devices/:id/pages`), and
  when the Central does not know the page either, the emulator refuses to sign
  — it never sends a decision it cannot prove.

The emulator accepts both forms (`PAGE pg_1f2e3d` and
`PAGE pg_1f2e3d <fingerprint>`); it refuses nothing else, and it never invents
a format of its own.

## The decision

When the human presses `a`, `b`, `c` or `d`:

1. the emulator sends `MCR 0001` … `MCR 0004` to the gateway;
2. it builds the claims of the PWA (`decisionSigningString` of `@bipeur/core`),
   signs them with the non-extractable ECDSA P-256 key of the device, and
   posts them to `POST /v1/pages/:id/decision` with the device token;
3. the Central verifies the signature, the device, the fingerprint, the
   deadline and the nonce, then records the decision and the audit event
   `page.decided`.

Without `--code` the emulator is not paired: the answer still reaches the
gateway, but nothing is signed, and the screen says so.

## The screen

```
┌────────────────────┐
│310 fw PUSH main>ori│
│gin 3 commits +120-1│
│4 #07c2             │
│                    │
└────────────────────┘

  A) Approve
  B) Deny

  state    answered
  code     310
  page     pg_7f3a1c
  delivery 4821 7730
  status   answer sent
  central  decision signed and accepted
  keys     a b c d answer — q hangs up
```

Four rows of twenty columns, printable ASCII only, accents transliterated: the
capacity of a real alphanumeric pager, and a hard constraint.

## Tests

| Test | What it proves |
|---|---|
| `test/frames.test.ts` | every frame of the contract is parsed, and an unknown line never throws |
| `test/lcd.test.ts` | the screen is 4 rows of 20 columns: cut, blank, never short |
| `test/keys.test.ts` | `a`…`d` and `1`…`4` answer `0001`…`0004`, `q` hangs up |
| `test/session.test.ts` | the state machine: registration, delivery, answer, expiry, refusal |
| `test/decision.test.ts` | the claims and the signature are the ones the Central verifies |
| `test/central.test.ts` | pairing and decision, with a fake `fetch`: no network in a test |
| `test/app.test.ts` | the whole application: a fake transport, a fake Central, no terminal |
