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
