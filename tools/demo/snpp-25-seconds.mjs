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
  stdio: ['pipe', 'pipe', 'pipe'],
});
const pagerLines = [];
pager.stdout.on('data', (chunk) => pagerLines.push(chunk.toString()));

/** Resolves once `marker` shows up on the pager's wire transcript (stderr). */
function waitForMarker(marker, timeoutMs, label) {
  return new Promise((done, fail) => {
    const timer = setTimeout(() => fail(new Error(label)), timeoutMs);
    let transit = '';
    pager.stderr.on('data', (chunk) => {
      transit += chunk.toString();
      if (transit.includes(marker)) {
        clearTimeout(timer);
        done();
      }
    });
  });
}

// The pager must hold its capcode before the terminal fires: `PAGE lea`
// answering `850` is what proves the unit is really on the channel.
const registered = waitForMarker('Unit Registered', 10_000, 'the pager did not register');
// The human answers only once the page is on the LCD: `SEND` is the last frame.
const delivered = waitForMarker('S: SEND', 15_000, 'the pager never received the page');

/** The terminal: the sender of 1995, with its lines buffered as they arrive. */
const socket = connect(port, host);
const queue = [];
const pending = [];
socket.on('data', (chunk) => {
  for (const line of chunk.toString().split('\r\n')) {
    if (line.length === 0) continue;
    const next = pending.shift();
    if (next) next(line);
    else queue.push(line);
  }
});

function reply(timeoutMs = 5000) {
  if (queue.length > 0) return Promise.resolve(queue.shift());
  return new Promise((done, fail) => {
    const timer = setTimeout(() => fail(new Error('no reply from the gateway')), timeoutMs);
    pending.push((line) => {
      clearTimeout(timer);
      done(line);
    });
  });
}

/** Send a command and wait for its answer. */
async function expect(command) {
  socket.write(`${command}\r\n`);
  return reply();
}

try {
  await registered;

  console.log('=== the terminal of 1995 (SNPP) ===');
  console.log(await reply());
  const credentials = process.env.BIPEUR_SNPP_LOGIN;
  if (credentials) {
    const [id, ...rest] = credentials.split(':');
    console.log(await expect(`LOGIN ${id} ${rest.join(':')}`));
  }
  console.log(await expect('2WAY'));
  console.log(await expect(`PAGE ${capcode}`));
  console.log(await expect(`MESS ${pageLine}`));
  console.log(await expect('RTYP MULTICHOICE'));
  console.log(await expect('MCRE 0001 Approve'));
  console.log(await expect('MCRE 0002 Deny'));
  const sent = await expect('SEND');
  console.log(sent);

  await delivered;
  await wait(300);
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