# SNPP — how to show a 1995 protocol to a 2026 jury

RFC 1861 (October 1995) describes *Simple Network Paging Protocol* level 3: a
two-way transaction with pre-seeded multiple-choice replies, a read
acknowledgement, an expiry and a message tag. That is, almost word for word, the
feature list of a modern "human in the loop" API — thirty-one years earlier.

**This document is not the transcript.** The canonical, byte-for-byte transcript
is owned by the gateway package and replayed by its test:

- `packages/snpp/test/fixtures/session.txt` — the transcript, one line per frame,
  `S:` for the server, `C:` for the client.
- `packages/snpp/test/session.test.ts` — replays it against an in-process TCP
  pair and fails on a single differing byte.
- `.kiro/steering/rfc1861.md` — the commands and reply codes we implement,
  extracted from the RFC.

If this page and the fixture ever disagree, **the fixture wins** and this page is
the bug. What follows is only the shooting script: what to type, in which order,
and what to say while it happens.

## The 25 seconds that carry the point

Open two windows side by side: a terminal on the left, the pager on the right.

```bash
nc 127.0.0.1 4440
```

Then type the sequence below. Type slowly — the pager needs a beat to light up,
and the jury needs to read the reply codes.

| What you type | What appears | What you say |
|---|---|---|
| `2WAY` | `250 OK, Beginning 2-Way Transaction` | "A two-way transaction. 1995." |
| `PAGE lea` | `850 Two-Way Unit Online and Available` | "The pager is online. `950` would have meant queued." |
| `ACKR 1` | `250 Read Acknowledgment Enabled` | "I want to know when it was read." |
| `MESS 310 fw PUSH main>origin 3 commits +120-14 #07c2` | `250 Message OK` | "One line. That is the whole page." |
| `RTYP MULTICHOICE` | `250 Reply Type Accepted` | "Multiple choice — seeded by the sender." |
| `MCRE 0001 Approve` | `250 Response Added to Transaction` | "Option A." |
| `MCRE 0002 Deny` | `250 Response Added to Transaction` | "Option B." |
| `SEND` | `861 4821 7730 Delivered, Awaiting Reply (MCR)` | "Fired. The tag is `4821`." |
| *(tap ✔ on the pager)* | — | "The human approves." |
| `MSTA 4821 7730` | `888 3 … 0001 MCR Reply Received` | "And the reply comes back as a code, not as a chat message." |

Close with `KTAG 4821 7730` then `QUIT`, and let the `421` closing line land.

## The unit side — a pager of 1995, in a terminal

`bip-pager` is the other half of RFC 1861: a **unit**, the device that
*receives*. It connects on the same TCP port as the terminals, registers itself
with its capcode, and draws what it receives on a 4 × 20 LCD in the terminal.
The keys answer; the answer travels back as an `MCResponse`.

Two windows, side by side — the terminal of 1995 on the left, the pager on the
right:

```bash
# left — the terminal
nc 127.0.0.1 4440

# right — the pager
bip-pager --host 127.0.0.1 --port 4440 --capcode lea \
          --central http://127.0.0.1:8787 --code ABC123
```

The terminal types `2WAY`, `PAGE lea`, `MESS …`, `RTYP MULTICHOICE`,
`MCRE 0001 Approve`, `MCRE 0002 Deny`, `SEND` — and the pager lights up:

```
U: UNIT lea
G: 250 OK, Unit Registered
G: PAGE pg_7f3a9c 3f786a68…
G: MESS 310 fw PUSH main>origin 3 commits +120-14 #07c2
G: MCRE 0001 Approve
G: MCRE 0002 Deny
G: SEND 4821 7730
```

The human presses `a` (or `b`) on the pager: the answer goes back as
`MCR 0001`, and the terminal reads `888 … MCR Reply Received`. The pager also
**signs** the decision at the Central with its ECDSA P-256 device key, so the
audit trail, the attention budget and the web PWA all see the same verdict.

| Key | Effect |
|---|---|
| `a` `b` `c` `d` (or `1`…`4`) | answer A, B, C, D → `MCR 0001`…`MCR 0004` |
| `q` | hang up → `QUIT` |

Without `--code` the emulator still receives and answers; it simply cannot
sign a decision at the Central, and says so on screen.

The wire format of the channel — the commands, the frames and the rules — is
written down in [`.kiro/steering/rfc1861.md`](../.kiro/steering/rfc1861.md)
and in [`packages/snpp/docs/SNPP.md`](../packages/snpp/docs/SNPP.md).

## Why this is the strongest 25 seconds of the video

Every notification product today sends a paragraph and expects a conversation.
This protocol, designed for a device with four rows of twenty characters, already
had: a bounded message, a closed set of replies, a read receipt, an expiry and a
correlation tag. The pager did not "inspire" Beeper — Beeper *is* that protocol,
with a JSON API behind it. Showing a jury a live TCP session is the difference
between claiming a lineage and demonstrating it.

## What not to do

- **Do not demo it through a wrapper.** A `curl` to a REST endpoint proves
  nothing; the point is that the wire speaks 1995.
- **Do not skip `MSTA`.** The reply code is the punchline: a decision that comes
  back as `888 … 0001`.
- **Do not fake it with a pre-recorded terminal.** Record the real `nc`; if it
  breaks, keep the break — it is more convincing than a perfect take.
- **Do not expose the port to make the demo easier.** It binds `127.0.0.1:4440`
  and `LOGIn` is required outside the loopback; a demo is not a reason to open a
  plaintext protocol to the Internet.
