import { describe, expect, it } from 'vitest';
import {
  fit,
  lampOf,
  layoutScreen,
  MockDisplay,
  type PendingPageView,
} from '../src/display.js';

const PAGE: PendingPageView = {
  pageId: 'pg_1',
  line: '310 fw PUSH deploy the whole website to production today',
  code: 310,
  risk: 'red',
  fingerprint: 'a1b2'.padEnd(64, '0'),
  options: [
    { code: 'A', label: 'merge' },
    { code: 'B', label: 'rebase' },
  ],
};

describe('lampOf', () => {
  it('maps a risk to its single lamp letter', () => {
    expect(lampOf('green')).toBe('G');
    expect(lampOf('amber')).toBe('A');
    expect(lampOf('red')).toBe('R');
  });
});

describe('fit', () => {
  it('truncates to the columns and pads the rest with spaces', () => {
    expect(fit('abcdefghij', 5)).toBe('abcde');
    expect(fit('ab', 5)).toBe('ab   ');
  });
});

describe('layoutScreen — 20×4', () => {
  it('lays a page on four rows of twenty columns, truncated', () => {
    const rows = layoutScreen(
      { page: PAGE, status: 'op' },
      { cols: 20, rows: 4, phase: 'paged' },
    );
    expect(rows).toHaveLength(4);
    for (const row of rows) expect(row).toHaveLength(20);
    expect(rows[0]).toBe('310 fw PUSH deploy t');
    expect(rows[1]).toContain('[R]');
    expect(rows[2]).toContain('A merge');
    expect(rows[3]).toContain('code 310');
  });

  it('shows the status and blanks when there is no page', () => {
    const rows = layoutScreen(
      { page: null, status: 'paired' },
      { cols: 20, rows: 4, phase: 'paired' },
    );
    expect(rows).toHaveLength(4);
    expect(rows[1]).toContain('paired');
  });
});

describe('layoutScreen — 16×2', () => {
  it('lays a page on two rows of sixteen columns', () => {
    const rows = layoutScreen(
      { page: PAGE, status: 'op' },
      { cols: 16, rows: 2, phase: 'paged' },
    );
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row).toHaveLength(16);
    expect(rows[0]).toBe('310 fw PUSH depl');
    expect(rows[1]).toContain('[R]');
    expect(rows[1]).toContain('A:merge');
  });
});

describe('MockDisplay', () => {
  it('writes the rows to the injected writer', () => {
    const written: string[] = [];
    const display = new MockDisplay((text) => written.push(text));
    display.write(['a', 'b']);
    expect(written).toEqual(['a\nb\n']);
  });
});