/**
 * `bip-pager --help`: the usage, the keys, and the demonstration session.
 */

/** The demonstration session: the unit channel, twenty-five seconds. */
export const DEMO_TRANSCRIPT: readonly string[] = [
  'S: 220 SNPP (V3) Gateway Ready',
  'C: UNIT lea',
  'S: 250 OK, Unit Registered',
  'S: PAGE pg_7f3a1c 41d9c0e2b7a5f6d8c3e4a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f6',
  'S: MESS 310 fw PUSH main>origin 3 commits +120-14 #07c2',
  'S: MCRE 0001 Approve',
  'S: MCRE 0002 Deny',
  'S: SEND 4821 7730',
  'C: MCR 0001',
  'S: 250 OK, Response Accepted',
];

export const HELP_TEXT = `bip-pager — a pager of 1995 in a 4x20 LCD terminal window

Usage
  bip-pager [--host 127.0.0.1] [--port 4440] [--capcode lea]
            [--central http://127.0.0.1:8787] [--code ABC123]

Options
  --host <address>   gateway of the unit channel, default 127.0.0.1
  --port <port>      port of the gateway, default 4440
  --capcode <id>     pager id of the unit channel, 1 to 20 characters, default lea
  --central <url>    Central base URL, default http://127.0.0.1:8787
  --code <ABC123>    pairing code of the Central: the emulator signs its decisions
  --help             this page

Keys
  a b c d            answer A, B, C, D  →  MCR 0001 … MCR 0004
  1 2 3 4            the same answers, numbered
  q                  hang up             →  QUIT

The screen shows the page on a 4x20 LCD, the seeded replies below it, the code
of the message and the state of the pager. The answer goes to the gateway as a
MCResponse; when the emulator is paired (--code), the decision is also signed
with the ECDSA P-256 key of the device and posted to the Central, so the page
is decided in the Central and audited there.

Demonstration session — twenty-five seconds, the gateway waits for the answer:
  bip-pager --port 4440 --capcode lea --code ABC123
  ... then press a.

${DEMO_TRANSCRIPT.join('\n')}
`;
