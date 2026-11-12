/**
 * The twenty-five seconds of RFC 1861, in one command.
 *
 *   node tools/demo/snpp-25-seconds.mjs [host] [port] [capcode]
 *
 * Two connections on the same TCP port: the **terminal** of 1995 (this script,
 * left) and the **pager** (`bip-pager`, right) — a *unit* of the channel: it
 * registers with its capcode, receives the page, shows it on a 4 × 20 LCD, and
 * answers `MCR 0001` when the human presses `a`.
 *
 * What it proves, in order:
 *   1. the terminal opens a two-way transaction (`2WAY`, `PAGE lea`);
 *   2. it writes the page line and seeds two replies (`MESS`, `RTYP`, `MCRE`);
 *   3. it fires (`SEND`) and reads `861 Delivered, Awaiting Reply (MCR)`;
 *   4. the pager lights up — the LCD shows the line, the keys A and B;
 *   5. the human answers: this script presses `a` on the pager;
 *   6. the terminal reads `888 … MCR Reply Received` — a code, not a paragraph.
 *
 * Requirements: a gateway on the port (`bipeur-snpp`) and `bip-pager` on the
 * PATH (or `BIP_PAGER=/path/to/bip-pager`).
 */
import { spawn } from 'node:child_process';
import { connect } from 'node:net';

const host = process.argv[2] ?? '127.0.0.1';
const port = Number(process.argv[3] ?? 4440);
const capcode = process.argv[4] ?? 'lea';
const pagerBin = process.env.BIP_PAGER ?? 'bip-pager';
const pageLine = '310 fw PUSH main>origin 3 commits +120-14 #07c2';

const wait = (ms) => new Promise((done) => setTimeout(done, ms));

/** The pager: a unit, connected, waiting for its page. */
const pager = spawn(pagerBin, ['--host', host, '--port', String(port), '--capcode', capcode], {
  stdio: ['pipe', 'pipe', 'inherit'],
});
const pagerLines = [];
pager.stdout.on('data', (chunk) => {
  pagerLines.push(chunk.toString());
});

/** The terminal: the sender of 1995. */
const socket = connect(port, host);
const terminalLines = [];
let buffer = '';
const waiting = [];

socket.on('data', (chunk) => {
  buffer += chunk.toString();
  let index = buffer.indexOf('\r\n');
  while (index >= 0) {
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 2);
    terminalLines.push(line);
    const next = waiting.shift();
    if (next) next(line);
    index = buffer.indexOf('\r\n');
  }
});

function send(line) {
  socket.write(`${line}\r\n`);
}

/** The next reply line of the terminal (waits for it). */
function reply(timeoutMs = 5000) {
  return new Promise((done, fail) => {
    const timer = setTimeout(() => fail(new Error('no reply from the gateway')), timeoutMs);
    waiting.push((line) => {
      clearTimeout(timer);
      done(line);
    });
  });
}

/** Send a command and wait for its answer. */
async function expect(command) {
  send(command);
  return reply();
}

try {
  await new Promise((done, fail) => {
    socket.once('connect', done);
    socket.once('error', fail);
  });

  console.log('=== the terminal of 1995 (SNPP) ===');
  console.log(await reply());
  console.log(await expect('2WAY'));
  console.log(await expect(`PAGE ${capcode}`));
  console.log(await expect(`MESS ${pageLine}`));
  console.log(await expect('RTYP MULTICHOICE'));
  console.log(await expect('MCRE 0001 Approve'));
  console.log(await expect('MCRE 0002 Deny'));
  const sent = await expect('SEND');
  console.log(sent);

  // The human answers on the pager: `a` is A, the first reply.
  await wait(1200);
  pager.stdin.write('a');
  await wait(1500);

  const [, tag, secret] = sent.split(' ');
  console.log(await expect(`MSTA ${tag} ${secret}`));
  console.log(await expect(`KTAG ${tag} ${secret}`));
  console.log(await expect('QUIT'));

  console.log();
  console.log(`=== the pager (bip-pager, capcode ${capcode}) ===`);
  process.stdout.write(pagerLines.join(''));
} finally {
  pager.kill();
  socket.destroy();
}
