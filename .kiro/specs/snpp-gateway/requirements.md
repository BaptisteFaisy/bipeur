# snpp-gateway — requirements

- **Route:** requirements first, **with the RFC attached** (A.13). The protocol
  is not ours to design: RFC 1861 (October 1995) is the specification, and the
  gateway is judged on its fidelity to it.
- **Attachment:** <https://www.rfc-editor.org/rfc/rfc1861.txt> — *Simple Network
  Paging Protocol, version 3*. The extracted command and reply-code table lives
  in `.kiro/steering/rfc1861.md` (always applied when a file under
  `packages/snpp/**` is in context) and the replayable transcript in
  `docs/SNPP.md`. Neither is duplicated here.
- **Covers:** BIP-F-28, property BIP-P-11. Lot A6 (optional, and the lot that
  carries the "resurrection" claim).

## BIP-F-28 (S) — SNPP gateway

THE CENTRAL SHALL accept a two-way transaction conforming to RFC 1861 (`2WAY`,
`PAGEr`, `MESSage`, `RTYPe`, `MCREsponse`, `ACKRead`, `EXPTag`, `SEND`,
`MSTAtus`, `KTAG`, `RESEt`, `QUIT`, `HELP`) and SHALL answer with the reply codes
of the RFC.

- Accept: the session of `docs/SNPP.md` replays byte for byte in a test.
- Accept: `SEND` answers `861 <tag> <secret>`; `MSTAtus` answers `861`, `870`,
  `888 <code> <text>` or `780`.
- Accept: a command out of sequence answers `503` and leaves the transaction
  intact.
- Accept: `HELP` lists the accepted commands and closes with `250`.
- Accept: the default bind is `127.0.0.1:4440`; outside the loopback `LOGIn` is
  required (RFC 1861 is plaintext).

## BIP-P-11 — the parser never throws

For any input line, the SNPP parser answers with a code from the RFC and never
raises an exception.

- Test: `packages/snpp/test/parser.props.test.ts`, fast-check over random byte
  strings including CR, LF, NUL, over-long lines and non-ASCII.

## Refinements taken from the RFC

1. Commands are matched case-insensitively on their four-letter prefix, exactly
   as the RFC writes them (`MESSage`, `RTYPe`, `MCREsponse`, `MSTAtus`).
2. The message is a single line: a CR or LF inside `MESSage` ends the command.
3. One transaction = one page. `RESEt` and `QUIT` release every tag held by the
   session; a closed socket does the same.
4. The gateway never invents a reply code: every code it sends appears in the
   table of `.kiro/steering/rfc1861.md`.

## Non-functional

| Id | Requirement |
|---|---|
| BIP-N-01 | A page fired through SNPP is delivered in under 2 s at p95. |
| BIP-N-03 | The SNPP port is loopback-only by default; `LOGIn` otherwise. |
| BIP-N-06 | No sound: the gateway has no audio path at all. |

## Out of scope

POCSAG and any radio transport; SNPP over TLS (out of scope of the loopback, and
documented as such); the historical privileged port 444.
