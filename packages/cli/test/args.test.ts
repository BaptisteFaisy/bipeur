import { describe, expect, it } from 'vitest';
import { parseArgs } from '../src/args.js';

describe('BIP-F-29 — bip argument parsing', () => {
  it('parses a yes/no question with a ttl', () => {
    const command = parseArgs(['ask', 'Deploy now?', '--yes-no', '--ttl', '10m']);
    expect(command.kind).toBe('ask');
    if (command.kind !== 'ask') return;
    expect(command.question).toBe('Deploy now?');
    expect(command.ttlMs).toBe(600_000);
    expect(command.options.map((option) => option.code)).toEqual(['A', 'B']);
    expect(command.yesNo).toBe(true);
  });

  it('seeds 2 to 4 choices and keeps the labels', () => {
    const command = parseArgs(['ask', 'Which date lib?', '--choice', 'A=dayjs,B=luxon,C=temporal']);
    if (command.kind !== 'ask') throw new Error('expected an ask command');
    expect(command.options).toEqual([
      { code: 'A', label: 'dayjs' },
      { code: 'B', label: 'luxon' },
      { code: 'C', label: 'temporal' },
    ]);
  });

  it('refuses a malformed --choice', () => {
    expect(parseArgs(['ask', 'x', '--choice', 'A=only-one'])).toMatchObject({ kind: 'error' });
    expect(parseArgs(['ask', 'x', '--choice', 'A=a,B=b,C=c,D=d,E=e'])).toMatchObject({ kind: 'error' });
    expect(parseArgs(['ask', 'x', '--choice', 'A=a,E=e'])).toMatchObject({ kind: 'error' });
    expect(parseArgs(['ask', 'x', '--choice', 'A=a,A=b'])).toMatchObject({ kind: 'error' });
  });

  it('refuses --yes-no with --choice', () => {
    const command = parseArgs(['ask', 'x', '--yes-no', '--choice', 'A=a,B=b']);
    expect(command).toMatchObject({ kind: 'error' });
  });

  it('refuses an invalid --ttl with a clear message', () => {
    const command = parseArgs(['ask', 'x', '--ttl', '10x']);
    if (command.kind !== 'error') throw new Error('expected an error command');
    expect(command.message).toContain('invalid --ttl');
  });

  it('bounds --ttl to 30s..1d', () => {
    expect(parseArgs(['ask', 'x', '--ttl', '5s'])).toMatchObject({ kind: 'error' });
    expect(parseArgs(['ask', 'x', '--ttl', '3d'])).toMatchObject({ kind: 'error' });
  });

  it('limits --detail to 240 characters', () => {
    expect(parseArgs(['ask', 'x', '--detail', 'a'.repeat(241)])).toMatchObject({ kind: 'error' });
    expect(parseArgs(['ask', 'x', '--detail', 'a'.repeat(240)])).toMatchObject({ kind: 'ask' });
  });

  it('parses notify, as a command or as a flag', () => {
    expect(parseArgs(['notify', 'night build finished'])).toMatchObject({
      kind: 'notify',
      line: 'night build finished',
    });
    expect(parseArgs(['--notify', 'night build finished'])).toMatchObject({ kind: 'notify' });
    expect(parseArgs(['--notify=night build finished'])).toMatchObject({ kind: 'notify' });
  });

  it('shows help without arguments', () => {
    expect(parseArgs([])).toEqual({ kind: 'help' });
    expect(parseArgs(['--help'])).toEqual({ kind: 'help' });
  });

  it('refuses an unknown option or command', () => {
    expect(parseArgs(['ask', 'x', '--nope'])).toMatchObject({ kind: 'error' });
    expect(parseArgs(['page', 'x'])).toMatchObject({ kind: 'error' });
    expect(parseArgs(['ask'])).toMatchObject({ kind: 'error' });
  });
});
