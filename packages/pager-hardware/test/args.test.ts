import { describe, expect, it } from 'vitest';
import { parseArgs, type HardwareOptions } from '../src/args.js';

function options(argv: string[]): HardwareOptions {
  const parsed = parseArgs(argv);
  if (typeof parsed === 'string') throw new Error(parsed);
  return parsed;
}

describe('parseArgs', () => {
  it('reads the defaults and the six-character code', () => {
    const opts = options(['--code', 'abc123']);
    expect(opts.code).toBe('ABC123');
    expect(opts.central).toBe('http://127.0.0.1:8787');
    expect(opts.display).toBe('mock');
    expect(opts.buttons).toBe('mock');
    expect(opts.buzzer).toBe('mock');
  });

  it('reads the real hardware flags', () => {
    const opts = options([
      '--code',
      'ABC123',
      '--central',
      'https://central.example.net',
      '--display',
      'hd44780',
      '--buttons',
      'gpio',
      '--buzzer',
      'gpio',
      '--poll',
      '500',
    ]);
    expect(opts).toMatchObject({
      central: 'https://central.example.net',
      display: 'hd44780',
      buttons: 'gpio',
      buzzer: 'gpio',
      pollMs: 500,
    });
  });

  it('strips the trailing slash of the Central URL', () => {
    expect(options(['--code', 'ABC123', '--central', 'http://x.example/']).central).toBe(
      'http://x.example',
    );
  });

  it('refuses a bad code and a bad choice', () => {
    expect(parseArgs(['--code', 'nope'])).toContain('invalid --code');
    expect(parseArgs(['--code', 'ABC123', '--display', 'crt'])).toContain('--display');
  });
});