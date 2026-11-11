/**
 * BIP-F-26 — the tool inputs are validated before anything reaches the Central:
 * a question that does not fit on a pager line, or an option code outside
 * A-D, is refused by the schema, not by the human.
 */
import { describe, expect, it } from 'vitest';
import {
  pageCancelInputSchema,
  pageHumanInputSchema,
  pageWaitInputSchema,
} from '../src/tools.js';

const valid = {
  question: 'Deploy main to production?',
  options: [
    { code: 'A', label: 'yes' },
    { code: 'B', label: 'no' },
  ],
  detail: 'three commits, tests green',
  ttl_seconds: 600,
};

describe('BIP-F-26 — page_human accepts a question that fits in 80 characters', () => {
  it('accepts the documented shape', () => {
    expect(pageHumanInputSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts a bare question without options', () => {
    expect(pageHumanInputSchema.safeParse({ question: 'Continue?' }).success).toBe(true);
  });
});

describe('BIP-F-26 — page_human refuses a question longer than 80 characters', () => {
  it('rejects 81 characters and accepts 80', () => {
    expect(pageHumanInputSchema.safeParse({ question: 'x'.repeat(81) }).success).toBe(false);
    expect(pageHumanInputSchema.safeParse({ question: 'x'.repeat(80) }).success).toBe(true);
  });

  it('rejects an empty question', () => {
    expect(pageHumanInputSchema.safeParse({ question: '' }).success).toBe(false);
  });
});

describe('BIP-F-26 — page_human refuses options outside A-D and out of range', () => {
  it('rejects a code outside A-D', () => {
    const parsed = pageHumanInputSchema.safeParse({
      question: 'Pick one',
      options: [
        { code: 'E', label: 'nope' },
        { code: 'A', label: 'yes' },
      ],
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects fewer than two and more than four options', () => {
    const one = pageHumanInputSchema.safeParse({
      question: 'Pick one',
      options: [{ code: 'A', label: 'yes' }],
    });
    const five = pageHumanInputSchema.safeParse({
      question: 'Pick one',
      options: ['A', 'B', 'C', 'D', 'A'].map((code) => ({ code, label: 'x' })),
    });
    expect(one.success).toBe(false);
    expect(five.success).toBe(false);
  });

  it('rejects a label longer than 20 characters and a TTL out of 30..86400', () => {
    const longLabel = pageHumanInputSchema.safeParse({
      question: 'Pick one',
      options: [
        { code: 'A', label: 'x'.repeat(21) },
        { code: 'B', label: 'no' },
      ],
    });
    expect(longLabel.success).toBe(false);
    expect(pageHumanInputSchema.safeParse({ ...valid, ttl_seconds: 29 }).success).toBe(false);
    expect(pageHumanInputSchema.safeParse({ ...valid, ttl_seconds: 86_401 }).success).toBe(false);
  });

  it('rejects a detail longer than 240 characters and a non-http callback', () => {
    expect(pageHumanInputSchema.safeParse({ ...valid, detail: 'x'.repeat(241) }).success).toBe(false);
    expect(
      pageHumanInputSchema.safeParse({ ...valid, callback_url: 'file:///etc/passwd' }).success,
    ).toBe(false);
  });
});

describe('BIP-F-26 — page_wait and page_cancel validate their page id', () => {
  it('requires a page id and a sane wait', () => {
    expect(pageWaitInputSchema.safeParse({ page_id: 'page_1', wait_seconds: 20 }).success).toBe(true);
    expect(pageWaitInputSchema.safeParse({ page_id: '', wait_seconds: 20 }).success).toBe(false);
    expect(pageWaitInputSchema.safeParse({ page_id: 'page_1', wait_seconds: 0 }).success).toBe(false);
    expect(pageCancelInputSchema.safeParse({ page_id: 'page_1' }).success).toBe(true);
    expect(pageCancelInputSchema.safeParse({ page_id: 'page_1', reason: 'x'.repeat(201) }).success).toBe(
      false,
    );
  });
});
