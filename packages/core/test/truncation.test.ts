/**
 * BIP-F-03 — the line fits the LCD, and what did not fit is still readable.
 *
 * The bug this file pins: a page line that did not fit was cut SILENTLY, and
 * for a question the cut text was lost for good — the human was asked to
 * answer a sentence he could not read anywhere on the pager.
 */
import { describe, expect, it } from 'vitest';
import { DETAIL_SCREENS_MAX, LINE_MAX } from '../src/ascii.js';
import { buildDetailScreens, composeLineDetailed, truncateSubject } from '../src/line.js';

const FINGERPRINT = 'a3f9'.padEnd(64, '0');

describe('BIP-F-03 — a cut line says it was cut', () => {
  it('marks the cut of a long subject', () => {
    const composed = composeLineDetailed({
      code: 510,
      station: 'oc',
      verb: 'PICK',
      subject: 'TEST branchement: 4 CLI branchement vers le depot ? A oui B non',
      fingerprint: FINGERPRINT,
    });
    expect(composed.truncated).toBe(true);
    expect(composed.line).toContain('~');
    expect(composed.line.length).toBeLessThanOrEqual(LINE_MAX);
    // The fingerprint tag is the link to the signed payload: it survives.
    expect(composed.line.endsWith('#a3f9')).toBe(true);
  });

  it('marks the cut of a single long word — the case that used to be silent', () => {
    const long = `/home/baptiste/${'chemin/'.repeat(20)}fin.js`;
    const out = truncateSubject(long, 60);
    expect(out.length).toBeLessThanOrEqual(60);
    expect(out.endsWith('~')).toBe(true);
    expect(out).not.toBe(long.slice(0, 60));
  });

  it('never invents a character but the marker', () => {
    const subject = 'un mot seul tres long '.repeat(6);
    const out = truncateSubject(subject, 40);
    for (const character of out) {
      if (character !== '~') expect(subject).toContain(character);
    }
  });

  it('keeps a short subject whole', () => {
    const composed = composeLineDetailed({
      code: 110,
      station: 'fw',
      verb: 'RUN',
      subject: 'rm -rf dist/',
      fingerprint: FINGERPRINT,
    });
    expect(composed.truncated).toBe(false);
    expect(composed.line).not.toContain('~');
    expect(composed.line).toBe('110 fw RUN rm -rf dist/ #a3f9');
  });
});

describe('BIP-F-16 — nothing the human decides on disappears', () => {
  it('carries a long text over the screens instead of cutting it', () => {
    const text = 'commande tres longue '.repeat(12).trim();
    const screens = buildDetailScreens({ full: text });
    expect(screens.length).toBeGreaterThan(1);
    expect(screens.length).toBeLessThanOrEqual(DETAIL_SCREENS_MAX);
    // Every word of the original is still there, in order.
    const rebuilt = screens.join(' ').replace(/\s+/g, ' ');
    expect(rebuilt).toBe(text);
  });

  it('keeps the agent prose labelled on every screen it appears on', () => {
    const prose = 'QXZJK1 '.concat('please approve this risky thing '.repeat(8));
    const screens = buildDetailScreens({ full: 'git push origin main', agentSays: prose });
    const proseScreens = screens.filter((screen) => screen.includes('QXZJK1'));
    expect(proseScreens.length).toBeGreaterThan(0);
    for (const screen of proseScreens) expect(screen.startsWith('AGENT SAYS:')).toBe(true);
  });

  it('keeps every screen inside the LCD geometry', () => {
    const screens = buildDetailScreens({
      full: 'x'.repeat(300),
      context: 'y'.repeat(200),
      agentSays: 'z'.repeat(150),
    });
    for (const screen of screens) expect(screen.length).toBeLessThanOrEqual(LINE_MAX);
  });
});
