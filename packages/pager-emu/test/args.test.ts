import { describe, expect, it } from 'vitest';
import { DEFAULTS, parseArgs } from '../src/args.js';

describe('BIP-F-33 — the arguments of the emulator', () => {
  it('has the defaults of the contract', () => {
    const options = parseArgs([]);
    expect(options).toMatchObject({
      host: '127.0.0.1',
      port: 4440,
      capcode: 'lea',
      central: 'http://127.0.0.1:8787',
      code: null,
    });
    expect(DEFAULTS.host).toBe('127.0.0.1');
  });

  it('reads the gateway, the pager id, the Central and the code', () => {
    const options = parseArgs([
      '--host',
      '127.0.0.1',
      '--port',
      '4455',
      '--capcode',
      'lea',
      '--central',
      'http://127.0.0.1:8787/',
      '--code',
      'abc123',
    ]);
    expect(options).toMatchObject({
      host: '127.0.0.1',
      port: 4455,
      capcode: 'lea',
      central: 'http://127.0.0.1:8787',
      code: 'ABC123',
    });
  });

  it('reads the options written with an equal sign', () => {
    const options = parseArgs(['--port=4455', '--capcode=fw']);
    expect(options).toMatchObject({ port: 4455, capcode: 'fw' });
  });

  it('asks for the help', () => {
    expect(parseArgs(['--help'])).toMatchObject({ help: true });
    expect(parseArgs(['-h'])).toMatchObject({ help: true });
  });

  it('refuses a pager id that is not one', () => {
    expect(parseArgs(['--capcode', 'way too long'])).toContain('invalid --capcode');
    expect(parseArgs(['--capcode', 'a b'])).toContain('invalid --capcode');
    expect(parseArgs(['--capcode', 'lea/x'])).toContain('invalid --capcode');
    expect(parseArgs(['--capcode', 'x'.repeat(21)])).toContain('invalid --capcode');
    expect(parseArgs(['--capcode', 'A1.b_c-2'])).toMatchObject({ capcode: 'A1.b_c-2' });
  });

  it('refuses a port that is not one', () => {
    expect(parseArgs(['--port', 'zero'])).toContain('invalid --port');
    expect(parseArgs(['--port', '70000'])).toContain('invalid --port');
  });

  it('refuses a code that is not six characters', () => {
    expect(parseArgs(['--code', 'ABC12'])).toContain('invalid --code');
    expect(parseArgs(['--code', 'ABC-12'])).toContain('invalid --code');
  });

  it('refuses a Central that is not an URL', () => {
    expect(parseArgs(['--central', '127.0.0.1:8787'])).toContain('invalid --central');
  });

  it('refuses an unknown option', () => {
    expect(parseArgs(['--nope'])).toContain('unknown option');
    expect(parseArgs(['--port'])).toContain('needs a value');
  });
});
