import { describe, expect, it } from 'vitest';
import { renderScreen } from '../src/screen.js';
import type { PagerView } from '../src/session.js';

const VIEW: PagerView = {
  state: 'delivered',
  capcode: 'lea',
  pageId: 'pg_7f3a1c',
  fingerprint: 'a'.repeat(64),
  code: 310,
  lines: ['310 fw PUSH main>origin 3 commits +120-14 #07c2'],
  choices: [
    { code: '0001', letter: 'A', label: 'Approve' },
    { code: '0002', letter: 'B', label: 'Deny' },
  ],
  tag: '4821',
  secret: '7730',
  status: 'delivered, waiting for an answer',
  answeredCode: null,
};

describe('BIP-F-33 — the screen of the emulator', () => {
  it('shows the LCD, the replies, the code and the state', () => {
    const screen = renderScreen(VIEW);
    expect(screen).toContain('│310 fw PUSH main>ori│');
    expect(screen).toContain('  A) Approve');
    expect(screen).toContain('  B) Deny');
    expect(screen).toContain('  code     310');
    expect(screen).toContain('  state    delivered');
    expect(screen).toContain('  page     pg_7f3a1c');
    expect(screen).toContain('  delivery 4821 7730');
    expect(screen).toContain('  keys     a b c d answer');
  });

  it('says when no reply was seeded', () => {
    const screen = renderScreen({ ...VIEW, choices: [] });
    expect(screen).toContain('no seeded reply');
  });

  it('shows what the Central answered', () => {
    const screen = renderScreen(VIEW, { central: 'decision signed and accepted' });
    expect(screen).toContain('  central  decision signed and accepted');
  });
});
