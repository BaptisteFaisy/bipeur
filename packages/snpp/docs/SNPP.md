# SNPP — speaking 1995 to a pager of 2026

`@bipeur/snpp` is a gateway for **SNPP level 3**, the Simple Network Paging
Protocol of [RFC 1861](https://www.rfc-editor.org/rfc/rfc1861.txt) (October
1995). A TCP client that knows nothing about Beeper opens a two-way transaction,
seeds multiple-choice replies, fires a page, then polls a message tag until the
human answers. The pager protocol already had everything the attention layer of
2026 needs: a single line, a bounded set of replies, a read acknowledgement, an
expiry, and a status tag that concludes with `888`.

```
S: 220 SNPP (V3) Gateway Ready
C: 2WAY
S: 250 OK, Beginning 2-Way Transaction
C: PAGE lea
S: 850 Two-Way Unit Online and Available; Transaction Accepted
C: ACKR 1
S: 250 Read Acknowledgment Enabled
C: MESS 310 fw PUSH main>origin 3 commits +120-14 #07c2
S: 250 Message OK
C: RTYP MULTICHOICE
S: 250 Reply Type Accepted
C: MCRE 0001 Approve
S: 250 Response Added to Transaction
C: MCRE 0002 Deny
S: 250 Response Added to Transaction
C: SEND
S: 861 4821 7730 Delivered, Awaiting Reply (MCR)
C: MSTA 4821 7730
S: 888 3 261124231455+1 0001 MCR Reply Received
```

That session is `DEMO_TRANSCRIPT` in `src/transcript.ts`; it is printed by
`bipeur-snpp --help` and **replayed by `test/transcript.test.ts`**, which also
checks that this document quotes it verbatim. Nothing below is a claim: every
line of it comes out of the gateway.

## Run it

```bash
pnpm --filter @bipeur/snpp build
BIPEUR_URL=http://127.0.0.1:8787 BIPEUR_TOKEN=<station token> \
  node packages/snpp/dist/bin.js

nc 127.0.0.1 4440          # then type the C: lines, one per line
```

| Variable | Default | Meaning |
|---|---|---|
| `BIPEUR_SNPP_HOST` | `127.0.0.1` | listen address; anything else needs `LOGIn` |
| `BIPEUR_SNPP_PORT` | `4440` | 444 is the historical port and is privileged |
| `BIPEUR_SNPP_LOGIN` | *(empty)* | `id:password`, required off the loopback |
| `BIPEUR_URL` | `http://127.0.0.1:8787` | Central base URL |
| `BIPEUR_TOKEN` | *(empty)* | station token, `Authorization: Bearer` |

`SIGTERM` and `SIGINT` close the listener, release every tag and exit 0.

## Commands

Commands are matched on their **four-letter prefix, case-insensitively**: the
RFC writes `MESSage`, `RTYPe`, `MCREsponse`, `MSTAtus`, `ACKRead`, `EXPTag`,
`PAGEr`, `RESEt`, `LOGIn`, and a client may send any casing of any of them.

| Command | Effect in Beeper | Reply |
|---|---|---|
| `2WAY` | opens a two-way decision request | `250 OK, Beginning 2-Way Transaction` |
| `PAGEr <id>` | selects the pager | `850` online, `950` queued for later |
| `ACKRead 0\|1` | asks for a read acknowledgement | `250 Read Acknowledgment Enabled` |
| `MESSage <line>` | the page line, one single line | `250 Message OK` |
| `RTYPe YESNO\|MULTICHOICE` | expected reply type | `250 Reply Type Accepted` |
| `MCREsponse <code> <text>` | seeds one possible reply, up to four | `250 Response Added to Transaction` |
| `EXPTag <hours>` | lifetime of the page, 1 to 168 hours | `250 Message Expiry Time Changed to 'n' Hours` |
| `SEND` | fires the page | `861 <tag> <secret> Delivered, Awaiting Reply (MCR)` |
| `MSTAtus <tag> <secret>` | status of a fired page | `861` / `870` / `888` / `780` |
| `KTAG <tag> <secret>` | releases the tag | `250 OK, Message Tag Released` |
| `RESEt` | abandons the transaction, releases every tag | `250 RESET OK` |
| `QUIT` | closes the session | `221 OK, Goodbye` |
| `HELP` | lists the accepted commands | `214` lines, then `250 OK` |
| `LOGIn <id> <password>` | authenticates the session | `250 Login Accepted` |

### `MSTAtus` — the four tiers of RFC 4.6.10

| Code | Meaning here |
|---|---|
| `861 <seq> <date> Delivered, Awaiting Reply (MCR)` | the Central holds the page, nobody has answered |
| `870 <seq> <date> Delivered, Read, Awaiting Reply (MCR)` | `ACKRead 1` and the pager showed the page |
| `888 <seq> <date> <code> MCR Reply Received` | the human answered; `<code>` is the seeded code |
| `780 <seq> <date> MESSAGE EXPIRED Before Delivery!` | nobody answered before the deadline |

`<date>` is the RFC 4.6.10 stamp `YYMMDDHHMMSS+GMT`: `261124231455+1` is
24 November 2026, 23:14:55, one hour east of Greenwich. `<seq>` counts the
status changes of the tag: `1` at SEND, `2` when read, `3` when answered.

## Reply codes

Every code the gateway can send is in `REPLIES` (`src/protocol.ts`) with the RFC
section that defines it; the gateway invents none of them.

| Code | Text | RFC |
|---|---|---|
| `214` | help lines | 4.2.1 |
| `220` | `SNPP (V3) Gateway Ready` | 4.1.1 |
| `221` | `OK, Goodbye` | 4.1.2 |
| `250` | `OK`, plus the per-command text of the table above | 4.2.3 |
| `421` | `Too Many Errors, Goodbye` / `Timeout, Goodbye` / `Illegal Access Attempt, LOGIn Required` | 4.2.4, 4.7, 4.8 |
| `501` | `Syntax Error in Command or Argument` | 4.2.5 |
| `502` | `Error! Would Duplicate Previously Entered MCResponse` | 4.6.7 |
| `503` | `Bad Sequence of Commands`, `ERROR, Message Already Entered`, `Error, Pager ID or Message Incomplete`, `Already Selected PAGEr` | 4.2.6 |
| `550` | `Illegal Reply Type`, `Invalid MCResponse Code`, `ERROR, Invalid Message`, `Unknown or Illegal Message_Tag or Pass_Code`, `Error, Invalid LoginID or Password`, `ERROR, Invalid Pager ID`, `ERROR, Unit Already Registered`, `ERROR, No Message Awaiting Reply` | 4.3.2, 4.5.1, 4.6.6, 4.6.8, 4.6.9, 4.6.10 |
| `552` | `Too Many MCResponses Entered` | 4.2.8 |
| `780` | `MESSAGE EXPIRED Before Delivery!` | 4.6.10 |
| `850` | `Two-Way Unit Online and Available; Transaction Accepted` | 4.6.8 |
| `861` | `Delivered, Awaiting Reply (MCR)` | 4.6.9 |
| `870` | `Delivered, Read, Awaiting Reply (MCR)` | 4.6.10 |
| `888` | `MCR Reply Received` | 4.6.10 |
| `950` | `Unit NOT Online; Message Will Be Queued for Later Delivery` | 4.6.8 |

## How a transaction becomes a page

```
client ──SNPP/TCP──▶ gateway ──POST /v1/pages───────────▶ Central ──▶ pager
                      │  ◀──{ page_id, fingerprint }───┘
                      │  GET /v1/pages/:id/decision?wait=N
                      │  ◀──{ status, choice }─────────┘
client ◀──888 <seq> <date> <code>──┘
```

- `SEND` answers `861` **before** the Central is called: the tag exists, the
  page is on its way, and `MSTAtus` tells the truth at any instant.
- `PAGEr` answers `850` when the Central answers its health probe, `950`
  otherwise. The page is still fired; the Central decides what to queue.
- The message is a page line (`CODE STATION VERB subject #hhhh`), so its
  fields are forwarded to the Central, which composes the line it displays —
  the honesty rule of the product applies to SNPP too. A message that is not a
  line becomes a plain question.
- `MCREsponse` seeds the pager's options: `0001` is choice **A**, `0002` **B**,
  `0003` **C**, `0004` **D**. The decision comes back as the matching code.
  `RTYPe YESNO` sends no options: the pager answers approve or deny, and the
  gateway reports `0001` or `0002`.
- Read acknowledgement (`ACKRead 1`) is observed by polling the page state on
  the Central. If that endpoint is unavailable, `870` is never sent and the tag
  goes from `861` straight to `888`.
- A page the Central refuses, or a decision that never comes, expires: `780`,
  and a page that expires is a refusal, never an approval (fail closed).

## The unit channel — the half of RFC 1861 that receives

Until now the gateway only spoke to *terminals*: the ones that send pages. A
**unit** is the other side — a real pager that receives them. It connects on
the same port, registers itself with its capcode, and the gateway pushes the
delivery to it; when the human answers on the pager, the answer travels back
as an `MCR` and the terminal that fired the page reads `888`.

```
U: UNIT lea
G: 250 OK, Unit Registered
G: PAGE pg_7f3a9c 3f786a68…(64 hex)
G: MESS 310 fw PUSH main>origin 3 commits +120-14 #07c2
G: MCRE 0001 Approve
G: MCRE 0002 Deny
G: SEND 4821 7730
U: MCR 0002
G: 250 OK, Response Accepted
```

| Command | Effect | Reply |
|---|---|---|
| `UNIT <capcode>` | registers the connection as the unit of a capcode (1 to 20 characters of `[A-Za-z0-9._-]`) | `250 OK, Unit Registered` |
| `MCR <code>` | the unit answers the message it displays (`0001`…`0004`) | `250 OK, Response Accepted` |
| `QUIT` | closes the session, as for a terminal | `221 OK, Goodbye` |

The frames the gateway pushes, in this order:

| Frame | What it carries |
|---|---|
| `PAGE <page_id> [<fingerprint>]` | the page of the Central, once it has accepted it: the unit signs its decision against that id |
| `MESS <line>` | the page line, 80 printable characters at most |
| `MCRE <code> <label>` | one seeded reply, the label 20 characters at most |
| `SEND <tag> <secret>` | the tag and the pass code of the transaction |
| `780 MESSAGE EXPIRED Before Delivery!` | the message expired before anybody answered |

- The capcode is a pager id: one connection carries one, and a capcode held by
  another connection is refused (`550 ERROR, Unit Already Registered`), as is
  a malformed one (`550 ERROR, Invalid Pager ID`).
- The delivery happens at `SEND`: the page is still created on the Central, so
  the PWA sees it too and may answer it. The unit only changes *how* the
  answer comes back.
- The `MCR` concludes the tag: the seeded code of the choice (`0001`→**A**,
  `0002`→**B**, `0003`→**C**, `0004`→**D**) is the code `MSTAtus` reports with
  `888 MCR Reply Received`.
- With no unit registered under the capcode, nothing changes: the page goes to
  the Central and the answer comes from the decision the Central holds.
- A registered unit speaks the unit vocabulary only: a terminal command on
  that connection answers `503 Bad Sequence of Commands`.
- The unit channel is exempt from `LOGIn`: a pager that cannot authenticate
  would never receive a page, and the gateway is loopback-only anyway.

## What is deliberately not implemented

Level 1 and level 2 of the RFC are out of scope: `TAP`/`IXO`/`TME` delivery,
`DATA` multi-line input, `NOQUEUE`, `PING`, `CALLerid`, `SUBJect`, `COVer`,
`HOLDuntil`, `DELete`. A client that sends one of them gets `501`, which is
exactly what RFC 4.2.5 asks of a gateway that does not implement a function.

One transaction carries one page, one recipient: that is what level 3 says, and
what Beeper does.

## Security

The protocol is plaintext and predates every habit of 2026: it is loopback only.
`loadConfig` refuses to start on a non-loopback address without
`BIPEUR_SNPP_LOGIN`, and a session that has not sent `LOGIn` is closed with
`421 Illegal Access Attempt, LOGIn Required` at its first other command.
Twenty client-side refusals close the connection (`421 Too Many Errors`), and an
idle session gets `421 Timeout` after five minutes. No payload is logged: the
gateway logs tags and errors only.

## Tests

| Test | What it proves |
|---|---|
| `test/parser.props.test.ts` | **BIP-P-11**: any line, binary or 2 kB long, yields a command or a `501`, and the server answers an RFC code — seed recorded |
| `test/parser.test.ts` | the four-letter prefix, case-insensitive, and the typed error |
| `test/transaction.test.ts` | out-of-sequence → `503`; `RESEt`/`QUIT` release the tags; two sessions never share one |
| `test/gateway.test.ts` | the transcript above, replayed over a real socket on an ephemeral loopback port, with an in-memory Central |
| `test/unit.test.ts` | the unit channel: registration, the delivery frames in order, the `MCR` that concludes the tag, the expiry |
| `test/config.test.ts` | `LOGIn` required off the loopback (configuration only, no listen) |
