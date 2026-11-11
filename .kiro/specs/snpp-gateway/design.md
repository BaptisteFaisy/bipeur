# snpp-gateway — design

Route: requirements first, RFC attached. The gateway is a small state machine
over a plain TCP socket, mapped onto the Central's page API. Package:
`packages/snpp` (today a placeholder; lot A6). Only `node:net` and the shared
contract are used — no protocol library, because the protocol is 300 lines of
text and a library would hide exactly what the video shows.

## 1. Session state machine

```
CONNECTED ──2WAY──▶ TWO_WAY ──PAGEr──▶ PAGER_SET ──MESSage──▶ MESSAGE_SET
   │                   │                  │                     │
   │                   │                  │                     ├─RTYPe──▶ RTYPE_SET
   │                   │                  │                     ├─ACKRead─▶ ACK_SET
   │                   │                  │                     └─EXPTag──▶ EXP_SET
   │                   │                  │                                   │
   │                   │                  └─────────────SEND──────────────────┘
   │                   │                                    │
   │                   │                                    ▼
   │                   │                              TAG_HELD (861 tag secret)
   │                   │                                    │
   │                   │                     MSTAtus ──▶ 861 | 870 | 888 | 780
   │                   │                     KTAG    ──▶ 250 (tag released)
   │                   │
   └──RESEt / QUIT / socket close ──▶ every tag released, page cancelled if pending
```

Any command outside its state answers `503` and changes nothing. The state table
is data (`src/states.ts`), the handler is a map `command → fn(session, args)`,
so adding `HELP` or `LOGIn` never touches the transition logic.

## 2. Mapping SNPP → Beeper

| SNPP | Beeper |
|---|---|
| `2WAY` | opens a decision request (kind `question` unless a `tool` payload is given) |
| `PAGEr <id>` | the device or station the page is aimed at; `850` online, `950` queued |
| `MESSage <text>` | the page line, one line, 80 printable ASCII characters |
| `RTYPe YESNO \| MULTICHOICE` | expected verdict; `MULTICHOICE` requires 2–4 seeded replies |
| `MCREsponse <code> <text>` | `PageOption { code: A..D, label }` — SNPP uses four digits, the pager shows letters, so `0001` → `A` |
| `ACKRead 1` | the page requires a read acknowledgement (`page.read` event) |
| `EXPTag <hours>` | `ttl_seconds = hours × 3600`, clamped to 30 s … 86400 s |
| `SEND` | `POST /v1/pages`; replies `861 <tag> <secret>` |
| `MSTAtus <tag> <secret>` | `GET /v1/pages/{id}/decision?wait=0`: `861` delivered, `870` read, `888 <choice> …` decided, `780` expired |
| `KTAG <tag> <secret>` | releases the tag; the page is cancelled if still pending |
| `RESEt`, `QUIT` | release every tag of the session |

The tag secret is generated with `randomBytes` and stored hashed, exactly like a
station token: a `MSTAtus` with the wrong secret answers `503`, never leaks the
page's existence.

## 3. Module layout

| Module | Role | Requirement |
|---|---|---|
| `src/server.ts` | `net.createServer`, one `Session` per socket, line buffering with a 512-byte cap | BIP-N-03 |
| `src/states.ts` | the transition table above, `canAccept(state, command)` | BIP-F-28 |
| `src/parser.ts` | `parseLine(line): {command, args} \| {error: code}` — never throws | **BIP-P-11** |
| `src/handlers.ts` | one function per command, no state of its own | BIP-F-28 |
| `src/codes.ts` | the reply-code constants, imported from `.kiro/steering/rfc1861.md`'s table | BIP-F-28 |
| `src/session.ts` | per-socket state, held tags, cleanup on close | BIP-F-28 |
| `src/bin.ts` | `bipeur-snpp`, bind `127.0.0.1:4440`, `LOGIn` outside the loopback | BIP-N-03 |

`parser.ts` is pure and total: it takes a string, returns a discriminated union,
and every branch ends in a code from the RFC. That totality is what BIP-P-11
tests — the property is a property of the *type*, not of a happy path.

## 4. Decisions and their reasons

1. **Loopback by default.** RFC 1861 has no encryption and the historical port
   was privileged. Exposing it would be a security regression disguised as
   compatibility; `LOGIn` exists in the RFC and is used for the rare remote case.
2. **One transaction, one page.** The temptation was to batch a session into
   several pages. Refused: a pager line is one decision, and SNPP's tag model
   already gives us one page per `SEND`.
3. **Four-digit codes mapped to letters at the edge.** The RFC's `MCREsponse`
   takes a numeric code; the pager's keys are A–D. The mapping lives in
   `handlers.ts` and nowhere else.
4. **The transcript is a test.** `docs/SNPP.md` holds the session shown in the
   video; `packages/snpp/test/session.test.ts` replays it against an in-process
   TCP pair (never the loopback port, so CI stays hermetic).

## 5. Tests

- `parser.props.test.ts` — BIP-P-11 over random bytes.
- `states.test.ts` — every out-of-sequence command answers `503`.
- `session.test.ts` — the `docs/SNPP.md` transcript, byte for byte.
- `tags.test.ts` — `KTAG`, `RESEt`, socket close release every tag; a pending
  page becomes `cancelled`.
