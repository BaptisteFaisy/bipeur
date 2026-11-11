/**
 * The transaction state machine (RFC 1861 §4.6): a command out of sequence
 * answers 503 and leaves the transaction untouched; RESEt and QUIT release
 * every tag the session holds.
 */
import { describe, expect, it } from 'vitest';
import { parse, type ParsedCommand } from '../src/parser.js';
import { formatSnppStamp } from '../src/protocol.js';
import {
  TagRegistry,
  Transaction,
  applyCommand,
  markExpired,
  markRead,
  markReplied,
  replyCodeFor,
  type TxContext,
  type TxOutcome,
} from '../src/transaction.js';

const NOW = Date.UTC(2026, 10, 24, 22, 14, 55);

function setup(overrides: Partial<TxContext> = {}): {
  tx: Transaction;
  ctx: TxContext;
  run: (line: string) => TxOutcome;
} {
  const tx = new Transaction();
  const ctx: TxContext = {
    now: NOW,
    online: true,
    tags: new TagRegistry(),
    newTag: () => '4821',
    newSecret: () => '7730',
    defaultTtlHours: 0.25,
    maxChoices: 4,
    maxMessageLength: 80,
    credentials: null,
    stamp: (epochMs: number) => formatSnppStamp(epochMs, 1),
    ...overrides,
  };
  const run = (line: string): TxOutcome => {
    const parsed: ReturnType<typeof parse> = parse(line);
    if (!parsed.ok) return { replies: [`${parsed.error.code} ${parsed.error.text}`] };
    return applyCommand(tx, parsed as ParsedCommand, ctx);
  };
  return { tx, ctx, run };
}

/** The A.9 transaction, up to SEND. */
function sentTransaction(): ReturnType<typeof setup> {
  const state = setup();
  for (const line of [
    '2WAY',
    'PAGE lea',
    'ACKR 1',
    'MESS 310 fw PUSH main>origin 3 commits +120-14 #07c2',
    'RTYP MULTICHOICE',
    'MCRE 0001 Approve',
    'MCRE 0002 Deny',
    'SEND',
  ]) {
    state.run(line);
  }
  return state;
}

describe('state machine — the RFC sequence', () => {
  it('walks IDLE → TWOWAY → PAGER → MESSAGE → RTYPE → MCRE → SEND', () => {
    const { tx, run } = setup();
    expect(tx.stage).toBe('IDLE');
    expect(run('2WAY').replies).toEqual(['250 OK, Beginning 2-Way Transaction']);
    expect(tx.stage).toBe('TWOWAY');
    expect(run('PAGE lea').replies).toEqual([
      '850 Two-Way Unit Online and Available; Transaction Accepted',
    ]);
    expect(run('MESS hello').replies).toEqual(['250 Message OK']);
    expect(run('RTYP YESNO').replies).toEqual(['250 Reply Type Accepted']);
    expect(run('SEND').replies).toEqual(['861 4821 7730 Delivered, Awaiting Reply (MCR)']);
    expect(tx.stage).toBe('WAIT_REPLY');
  });

  it('answers 950 when the pager is offline, and still accepts the page', () => {
    const { run } = setup({ online: false });
    run('2WAY');
    expect(run('PAGE lea').replies).toEqual([
      '950 Unit NOT Online; Message Will Be Queued for Later Delivery',
    ]);
    expect(run('MESS hello').replies).toEqual(['250 Message OK']);
  });

  it('a second 2WAY while one is open answers 550', () => {
    const { run } = setup();
    run('2WAY');
    expect(run('2WAY').replies).toEqual([
      '550 Error, Standard Transaction Already Underway, use RESEt',
    ]);
  });
});

describe('state machine — out of sequence answers 503 without corrupting the state', () => {
  it.each(['PAGE lea', 'MESS hi', 'RTYP YESNO', 'MCRE 0001 x', 'ACKR 1', 'EXPT 4'])(
    '%s before 2WAY → 503',
    (line) => {
      const { tx, run, ctx } = setup();
      const outcome = run(line);
      expect(outcome.replies[0]!.startsWith('503 ')).toBe(true);
      expect(tx.stage).toBe('IDLE');
      expect(tx.pager).toBeNull();
      expect(tx.message).toBeNull();
      expect(ctx.tags.size).toBe(0);
    },
  );

  it('SEND without a pager or a message → 503 incomplete', () => {
    const { tx, run } = setup();
    run('2WAY');
    expect(run('SEND').replies).toEqual(['503 Error, Pager ID or Message Incomplete']);
    expect(tx.stage).toBe('TWOWAY');
  });

  it('a duplicate MESSage → 503 and the first line survives', () => {
    const { tx, run } = setup();
    run('2WAY');
    run('MESS first');
    expect(run('MESS second').replies).toEqual(['503 ERROR, Message Already Entered']);
    expect(tx.message).toBe('first');
  });

  it('a second PAGEr → 503 already selected', () => {
    const { tx, run } = setup();
    run('2WAY');
    run('PAGE lea');
    expect(run('PAGE bob').replies).toEqual(['503 Already Selected PAGEr']);
    expect(tx.pager).toBe('lea');
  });

  it('a malformed argument answers 501 and changes nothing', () => {
    const { tx, run } = setup();
    run('2WAY');
    expect(run('ACKR 7').replies[0]!.startsWith('501 ')).toBe(true);
    expect(tx.ackRead).toBe(false);
    expect(run('RTYP MAYBE').replies).toEqual(['550 Illegal Reply Type']);
    expect(tx.replyType).toBe('NONE');
  });

  it('a command after SEND answers 503, the fired tag survives', () => {
    const { tx, ctx, run } = sentTransaction();
    expect(run('MESS again').replies[0]!.startsWith('503 ')).toBe(true);
    expect(ctx.tags.size).toBe(1);
    expect(tx.message).toBeNull();
  });
});

describe('state machine — RESEt and QUIT release every tag', () => {
  it('RESEt clears the transaction and the tags', () => {
    const { tx, ctx, run } = sentTransaction();
    expect(ctx.tags.size).toBe(1);
    expect(run('RESE').replies).toEqual(['250 RESET OK']);
    expect(ctx.tags.size).toBe(0);
    expect(tx.stage).toBe('IDLE');
    // The tag is gone: the status command no longer knows it (RFC 4.6.10).
    expect(run('MSTA 4821 7730').replies).toEqual([
      '550 Unknown or Illegal Message_Tag or Pass_Code',
    ]);
  });

  it('QUIT answers 221, releases the tags and asks the session to close', () => {
    const { ctx, run } = sentTransaction();
    const outcome = run('QUIT');
    expect(outcome.replies).toEqual(['221 OK, Goodbye']);
    expect(outcome.quit).toBe(true);
    expect(ctx.tags.size).toBe(0);
  });

  it('KTAG releases one tag, and only with the right secret', () => {
    const { ctx, run } = sentTransaction();
    expect(run('KTAG 4821 0000').replies).toEqual([
      '550 Unknown or Illegal Message_Tag or Pass_Code',
    ]);
    expect(ctx.tags.size).toBe(1);
    expect(run('KTAG 4821 7730').replies).toEqual(['250 OK, Message Tag Released']);
    expect(ctx.tags.size).toBe(0);
  });

  it('two transactions never share a tag', () => {
    const first = sentTransaction();
    const second = sentTransaction();
    expect(first.ctx.tags.get('4821')).toBeDefined();
    second.run('RESE');
    expect(second.ctx.tags.size).toBe(0);
    expect(first.ctx.tags.get('4821')).toBeDefined();
  });
});

describe('MCREsponse — up to four seeded replies, as the RFC wants', () => {
  it('refuses a choice when MULTICHOICE is not enabled', () => {
    const { run } = setup();
    run('2WAY');
    expect(run('MCRE 0001 Approve').replies).toEqual(['550 MCResponses Not Enabled']);
  });

  it('refuses a fifth reply with 552 and a duplicate with 502', () => {
    const { run } = setup();
    run('2WAY');
    run('RTYP MULTICHOICE');
    for (const code of ['0001', '0002', '0003', '0004']) run(`MCRE ${code} x`);
    expect(run('MCRE 0005 y').replies).toEqual(['552 Too Many MCResponses Entered']);
    expect(run('MCRE 0001 z').replies[0]!.startsWith('502 ')).toBe(true);
  });

  it('accepts the four-digit and the hex code forms of the RFC', () => {
    const { run } = setup();
    run('2WAY');
    run('RTYP MULTICHOICE');
    expect(run('MCRE 1E2C Here is one response').replies).toEqual([
      '250 Response Added to Transaction',
    ]);
  });
});

describe('MSTAtus — the four tiers of RFC 4.6.10', () => {
  it('861 while nobody answered, then 870 when read, then 888', () => {
    const { ctx, run } = sentTransaction();
    expect(run('MSTA 4821 7730').replies).toEqual([
      '861 1 261124231455+1 Delivered, Awaiting Reply (MCR)',
    ]);
    const record = ctx.tags.get('4821')!;
    markRead(record, NOW);
    expect(run('MSTA 4821 7730').replies).toEqual([
      '870 2 261124231455+1 Delivered, Read, Awaiting Reply (MCR)',
    ]);
    markReplied(record, NOW, '0001');
    expect(run('MSTA 4821 7730').replies).toEqual([
      '888 3 261124231455+1 0001 MCR Reply Received',
    ]);
  });

  it('780 when the page expires unanswered', () => {
    const { ctx, run } = sentTransaction();
    markExpired(ctx.tags.get('4821')!, NOW);
    expect(run('MSTA 4821 7730').replies).toEqual([
      '780 2 261124231455+1 MESSAGE EXPIRED Before Delivery!',
    ]);
  });

  it('780 as soon as the deadline passed, even with no decision', () => {
    const { ctx } = sentTransaction();
    const late = { ...ctx, now: NOW + 60 * 60 * 1000 };
    const parsed = parse('MSTA 4821 7730');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const outcome = applyCommand(new Transaction(), parsed, late);
    expect(outcome.replies[0]!.startsWith('780 ')).toBe(true);
  });

  it('550 on an unknown tag or a wrong secret', () => {
    const { run } = sentTransaction();
    expect(run('MSTA 0000 7730').replies).toEqual([
      '550 Unknown or Illegal Message_Tag or Pass_Code',
    ]);
    expect(run('MSTA 4821 1234').replies).toEqual([
      '550 Unknown or Illegal Message_Tag or Pass_Code',
    ]);
  });
});

/** Only the seeded choices matter to `replyCodeFor`. */
function recordWith(choices: { code: string; text: string }[]): Parameters<typeof replyCodeFor>[0] {
  return { choices } as unknown as Parameters<typeof replyCodeFor>[0];
}

describe('replyCodeFor — the decision maps back to the seeded code', () => {
  const record = recordWith([
    { code: '0001', text: 'Approve' },
    { code: '0002', text: 'Deny' },
    { code: '0003', text: 'Later' },
  ]);

  it('maps a letter choice to the n-th seeded code', () => {
    expect(replyCodeFor(record, 'choice', 'A')).toBe('0001');
    expect(replyCodeFor(record, 'choice', 'B')).toBe('0002');
    expect(replyCodeFor(record, 'choice', 'C')).toBe('0003');
  });

  it('maps approve and deny without options', () => {
    expect(replyCodeFor(record, 'approved', null)).toBe('0001');
    expect(replyCodeFor(record, 'denied', null)).toBe('0002');
  });

  it('falls back to the first code when nothing was seeded', () => {
    const bare = recordWith([]);
    expect(replyCodeFor(bare, 'choice', 'B')).toBe('0001');
  });
});

describe('LOGIn — credentials of the session', () => {
  it('accepts the configured pair and refuses anything else', () => {
    const { tx, run } = setup({ credentials: { id: 'admin', password: 'secret' } });
    expect(run('LOGI admin nope').replies).toEqual([
      '550 Error, Invalid LoginID or Password',
    ]);
    expect(tx.authenticated).toBe(false);
    expect(run('LOGI admin secret').replies).toEqual(['250 Login Accepted']);
    expect(tx.authenticated).toBe(true);
  });

  it('accepts any login on the loopback, where none is configured', () => {
    const { run } = setup();
    expect(run('LOGI anyone anything').replies).toEqual(['250 Login Accepted']);
  });
});
