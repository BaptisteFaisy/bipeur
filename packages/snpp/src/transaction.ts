/**
 * The two-way transaction (RFC 1861 §4.1.3, §4.6) as a state machine.
 *
 * `IDLE → TWOWAY → PAGER → MESSAGE → RTYPE → MCRE* → SEND → WAIT_REPLY → DONE`
 *
 * The stage only moves forward, so a client may fill the fields in any order
 * (the RFC transcript sends MESSage before RTYPe, others do the opposite), but
 * a command whose prerequisite is missing answers 503 and leaves the state
 * untouched. Tags outlive the transaction: `MSTAtus` keeps working after SEND.
 */
import { COMMANDS, formatReply, formatReplyAs, type ReplyName } from './protocol.js';
import type { ParsedCommand } from './parser.js';

export type TxStage =
  | 'IDLE'
  | 'TWOWAY'
  | 'PAGER'
  | 'MESSAGE'
  | 'RTYPE'
  | 'MCRE'
  | 'SEND'
  | 'WAIT_REPLY'
  | 'DONE';

export const STAGE_ORDER: readonly TxStage[] = [
  'IDLE',
  'TWOWAY',
  'PAGER',
  'MESSAGE',
  'RTYPE',
  'MCRE',
  'SEND',
  'WAIT_REPLY',
  'DONE',
];

/** RTYPe values of RFC 4.6.6. */
export const REPLY_TYPES = ['NONE', 'YESNO', 'SIMREPLY', 'MULTICHOICE', 'TEXT'] as const;
export type ReplyType = (typeof REPLY_TYPES)[number];

/** One seeded multiple-choice reply (`MCREsponse <code> <text>`). */
export interface Choice {
  /** Up to four hex digits, as the RFC writes them (`0001`, `1E2C`). */
  code: string;
  text: string;
}

export type TagStatus = 'delivered' | 'read' | 'replied' | 'expired';

/** What the gateway keeps for one fired page, until `KTAG` or expiry. */
export interface TagRecord {
  tag: string;
  secret: string;
  /** Beeper page id, once the Central has accepted the page. */
  pageId: string | null;
  pager: string;
  message: string;
  choices: readonly Choice[];
  ackRead: boolean;
  status: TagStatus;
  /** Reply code reported by `888`, e.g. `0001`. */
  replyCode: string | null;
  /** RFC 4.6.10 `<Sequence>`: one per status change. */
  sequence: number;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
}

export class TagRegistry {
  private readonly records = new Map<string, TagRecord>();

  add(record: TagRecord): void {
    this.records.set(record.tag, record);
  }

  get(tag: string): TagRecord | undefined {
    return this.records.get(tag);
  }

  /** Tag and secret must both match: the secret authorises status checks. */
  find(tag: string, secret: string): TagRecord | undefined {
    const record = this.records.get(tag);
    return record && record.secret === secret ? record : undefined;
  }

  release(tag: string): boolean {
    return this.records.delete(tag);
  }

  clear(): number {
    const count = this.records.size;
    this.records.clear();
    return count;
  }

  get size(): number {
    return this.records.size;
  }
}

export class Transaction {
  stage: TxStage = 'IDLE';
  pager: string | null = null;
  message: string | null = null;
  replyType: ReplyType = 'NONE';
  choices: Choice[] = [];
  ackRead = false;
  expiryHours: number | null = null;
  authenticated = false;

  /** Clear the transaction, keep the login (RESEt, or a new 2WAY after SEND). */
  reset(): void {
    this.stage = 'IDLE';
    this.pager = null;
    this.message = null;
    this.replyType = 'NONE';
    this.choices = [];
    this.ackRead = false;
    this.expiryHours = null;
  }

  advance(stage: TxStage): void {
    if (STAGE_ORDER.indexOf(stage) > STAGE_ORDER.indexOf(this.stage)) this.stage = stage;
  }
}

export interface TxContext {
  now: number;
  /** Is the pager online right now? Decided by the gateway before PAGEr. */
  online: boolean;
  tags: TagRegistry;
  newTag: () => string;
  newSecret: () => string;
  /** Lifetime of a page when the client sends no `EXPTag`, in hours. */
  defaultTtlHours: number;
  maxChoices: number;
  maxMessageLength: number;
  /** Credentials required by `LOGIn`, or null when the gateway is on loopback. */
  credentials: { id: string; password: string } | null;
  /** RFC 4.6.10 timestamp formatter: `YYMMDDHHMMSS+GMT`. */
  stamp: (epochMs: number) => string;
}

/** A page to create, produced by SEND and carried out by the gateway. */
export interface FiredPage {
  tag: string;
  secret: string;
  pager: string;
  message: string;
  choices: readonly Choice[];
  replyType: ReplyType;
  ackRead: boolean;
  expiresAt: number;
}

export interface TxOutcome {
  replies: string[];
  /** Set by SEND: the gateway must create the page on the Central. */
  fired?: FiredPage;
  /** Set by QUIT: the session must close after the reply is written. */
  quit?: boolean;
}

type Handler = (tx: Transaction, cmd: ParsedCommand, ctx: TxContext) => TxOutcome;

/** One reply line, by name: the only way a handler answers. */
const reply = (name: ReplyName, params: readonly string[] = []): TxOutcome => ({
  replies: [formatReply(name, params)],
});

/**
 * Commands other than LOGIn/HELP/QUIT/MSTAtus/KTAG need an open 2WAY
 * transaction: IDLE (never opened) and DONE (already sent) both answer 503.
 */
function needsTransaction(tx: Transaction): TxOutcome | null {
  const open = STAGE_ORDER.indexOf(tx.stage) >= STAGE_ORDER.indexOf('TWOWAY');
  const notSent = tx.stage !== 'DONE' && tx.stage !== 'WAIT_REPLY';
  return open && notSent ? null : reply('BAD_SEQUENCE');
}

function handleTwoWay(tx: Transaction, _cmd: ParsedCommand, _ctx: TxContext): TxOutcome {
  // SEND and RESEt both return the session to non-2WAY mode (RFC 4.6.1).
  const reopenable = tx.stage === 'IDLE' || tx.stage === 'DONE' || tx.stage === 'WAIT_REPLY';
  if (!reopenable) return reply('TWOWAY_UNDERWAY');
  tx.reset();
  tx.stage = 'TWOWAY';
  return reply('TWOWAY_STARTED');
}

function handlePager(tx: Transaction, cmd: ParsedCommand, ctx: TxContext): TxOutcome {
  const id = cmd.args[0];
  if (!id) return reply('SYNTAX');
  const blocked = needsTransaction(tx);
  if (blocked) return blocked;
  if (tx.pager) return reply('PAGER_ALREADY');
  tx.pager = id;
  tx.advance('PAGER');
  return reply(ctx.online ? 'UNIT_ONLINE' : 'UNIT_QUEUED');
}

function handleAckRead(tx: Transaction, cmd: ParsedCommand, _ctx: TxContext): TxOutcome {
  const flag = cmd.args[0];
  if (flag !== '0' && flag !== '1') return reply('SYNTAX');
  const blocked = needsTransaction(tx);
  if (blocked) return blocked;
  tx.ackRead = flag === '1';
  return reply(tx.ackRead ? 'ACK_ENABLED' : 'ACK_DISABLED');
}

function handleMessage(tx: Transaction, cmd: ParsedCommand, ctx: TxContext): TxOutcome {
  if (cmd.rest.length === 0) return reply('SYNTAX');
  const blocked = needsTransaction(tx);
  if (blocked) return blocked;
  if (tx.message !== null) return reply('MESSAGE_DUPLICATE');
  if (cmd.rest.length > ctx.maxMessageLength) return reply('MESSAGE_INVALID');
  tx.message = cmd.rest;
  tx.advance('MESSAGE');
  return reply('MESSAGE_OK');
}

function handleReplyType(tx: Transaction, cmd: ParsedCommand, _ctx: TxContext): TxOutcome {
  const type = (cmd.args[0] ?? '').toUpperCase();
  if (!REPLY_TYPES.includes(type as ReplyType)) return reply('REPLY_TYPE_ILLEGAL');
  const blocked = needsTransaction(tx);
  if (blocked) return blocked;
  if (tx.replyType !== 'NONE') return reply('BAD_SEQUENCE');
  tx.replyType = type as ReplyType;
  tx.advance('RTYPE');
  return reply('REPLY_TYPE_ACCEPTED');
}

function handleChoice(tx: Transaction, cmd: ParsedCommand, ctx: TxContext): TxOutcome {
  const blocked = needsTransaction(tx);
  if (blocked) return blocked;
  if (tx.replyType !== 'MULTICHOICE') return reply('MCR_NOT_ENABLED');
  const code = cmd.args[0] ?? '';
  if (!/^[0-9A-Fa-f]{1,4}$/.test(code)) return reply('MCR_INVALID');
  if (tx.choices.some((choice) => choice.code.toLowerCase() === code.toLowerCase())) {
    return reply('MCR_DUPLICATE');
  }
  if (tx.choices.length >= ctx.maxChoices) return reply('MCR_TOO_MANY');
  tx.choices.push({ code, text: cmd.args.slice(1).join(' ') });
  tx.advance('MCRE');
  return reply('MCR_ADDED');
}

function handleExpiry(tx: Transaction, cmd: ParsedCommand, _ctx: TxContext): TxOutcome {
  const hours = Number(cmd.args[0]);
  if (!Number.isInteger(hours) || hours < 1 || hours > 168) return reply('SYNTAX');
  const blocked = needsTransaction(tx);
  if (blocked) return blocked;
  tx.expiryHours = hours;
  return {
    replies: [
      formatReplyAs('EXPIRY_CHANGED', `Message Expiry Time Changed to '${hours}' Hours`),
    ],
  };
}

function handleSend(tx: Transaction, _cmd: ParsedCommand, ctx: TxContext): TxOutcome {
  if (!tx.pager || !tx.message) return reply('INCOMPLETE');
  const hours = tx.expiryHours ?? ctx.defaultTtlHours;
  const fired: FiredPage = {
    tag: ctx.newTag(),
    secret: ctx.newSecret(),
    pager: tx.pager,
    message: tx.message,
    choices: [...tx.choices],
    replyType: tx.replyType,
    ackRead: tx.ackRead,
    expiresAt: ctx.now + hours * 3_600_000,
  };
  ctx.tags.add({
    tag: fired.tag,
    secret: fired.secret,
    pageId: null,
    pager: fired.pager,
    message: fired.message,
    choices: fired.choices,
    ackRead: fired.ackRead,
    status: 'delivered',
    replyCode: null,
    sequence: 1,
    createdAt: ctx.now,
    updatedAt: ctx.now,
    expiresAt: fired.expiresAt,
  });
  // RFC 4.6.1: SEND closes the transaction. The tag outlives it (MSTAtus).
  tx.reset();
  tx.stage = 'WAIT_REPLY';
  return { replies: [formatReply('SENT_AWAITING_REPLY', [fired.tag, fired.secret])], fired };
}

/** `861`, `870`, `888` or `780`: the four tiers of RFC 4.6.10. */
function statusReply(record: TagRecord, ctx: TxContext): string {
  const params = [String(record.sequence), ctx.stamp(record.updatedAt)];
  switch (record.status) {
    case 'delivered':
      return formatReply('STATUS_AWAITING_REPLY', params);
    case 'read':
      return formatReply('STATUS_READ', params);
    case 'replied':
      return formatReply('STATUS_REPLY', [...params, record.replyCode ?? '0001']);
    default:
      return formatReply('STATUS_EXPIRED', params);
  }
}

function handleStatus(_tx: Transaction, cmd: ParsedCommand, ctx: TxContext): TxOutcome {
  const [tag, secret] = cmd.args;
  if (!tag || !secret) return reply('SYNTAX');
  const record = ctx.tags.find(tag, secret);
  if (!record) return reply('UNKNOWN_TAG');
  // A tag past its lifetime answers 780 even if no decision ever arrived.
  if (record.status !== 'replied' && record.status !== 'expired' && ctx.now >= record.expiresAt) {
    markExpired(record, ctx.now);
  }
  return { replies: [statusReply(record, ctx)] };
}

function handleKillTag(_tx: Transaction, cmd: ParsedCommand, ctx: TxContext): TxOutcome {
  const [tag, secret] = cmd.args;
  if (!tag || !secret) return reply('SYNTAX');
  if (!ctx.tags.find(tag, secret)) return reply('UNKNOWN_TAG');
  ctx.tags.release(tag);
  return reply('TAG_RELEASED');
}

function handleReset(tx: Transaction, _cmd: ParsedCommand, ctx: TxContext): TxOutcome {
  tx.reset();
  ctx.tags.clear();
  return reply('RESET_OK');
}

function handleQuit(tx: Transaction, _cmd: ParsedCommand, ctx: TxContext): TxOutcome {
  tx.reset();
  ctx.tags.clear();
  return { replies: [formatReply('QUIT_OK')], quit: true };
}

function handleHelp(_tx: Transaction, _cmd: ParsedCommand, _ctx: TxContext): TxOutcome {
  const lines = HELP_TEXT.map((text) => formatReplyAs('HELP_LINE', text));
  return { replies: [...lines, formatReply('OK')] };
}

function handleLogin(tx: Transaction, cmd: ParsedCommand, ctx: TxContext): TxOutcome {
  const [id, password] = cmd.args;
  if (!id || !password) return reply('SYNTAX');
  if (!ctx.credentials) {
    tx.authenticated = true;
    return reply('LOGIN_ACCEPTED');
  }
  const matches =
    id === ctx.credentials.id && password === ctx.credentials.password;
  tx.authenticated = matches;
  return reply(matches ? 'LOGIN_ACCEPTED' : 'LOGIN_REFUSED');
}

const HELP_TEXT: readonly string[] = COMMANDS.map(
  (spec) => `${spec.usage.padEnd(24)} ${spec.summary}`,
);

const HANDLERS: Readonly<Record<ParsedCommand['verb'], Handler>> = {
  '2WAY': handleTwoWay,
  PAGE: handlePager,
  MESS: handleMessage,
  RTYP: handleReplyType,
  MCRE: handleChoice,
  ACKR: handleAckRead,
  EXPT: handleExpiry,
  SEND: handleSend,
  MSTA: handleStatus,
  KTAG: handleKillTag,
  RESET: handleReset,
  QUIT: handleQuit,
  HELP: handleHelp,
  LOGIN: handleLogin,
};

/** Apply one parsed command. Pure: no I/O, no clock of its own. */
export function applyCommand(tx: Transaction, cmd: ParsedCommand, ctx: TxContext): TxOutcome {
  const handler = HANDLERS[cmd.verb];
  if (!handler) return reply('SYNTAX');
  return handler(tx, cmd, ctx);
}

/** Record a read acknowledgement: one more status change (RFC 4.6.10). */
export function markRead(record: TagRecord, now: number): void {
  if (record.status !== 'delivered') return;
  record.status = 'read';
  record.sequence += 1;
  record.updatedAt = now;
}

/** Record the decision: the transaction is concluded, `888` from now on. */
export function markReplied(record: TagRecord, now: number, replyCode: string): void {
  if (record.status === 'replied' || record.status === 'expired') return;
  record.status = 'replied';
  record.replyCode = replyCode;
  record.sequence += 1;
  record.updatedAt = now;
}

export function markExpired(record: TagRecord, now: number): void {
  if (record.status === 'replied' || record.status === 'expired') return;
  record.status = 'expired';
  record.sequence += 1;
  record.updatedAt = now;
}

/** Reply code a decision maps to: the seeded code, by letter or by verdict. */
export function replyCodeFor(record: TagRecord, verdict: string, choice: string | null): string {
  const codes = record.choices.map((c) => c.code);
  if (verdict === 'choice' && choice) {
    const index = choice.toUpperCase().charCodeAt(0) - 65;
    return codes[index] ?? codes[0] ?? '0001';
  }
  if (verdict === 'approved') return codes[0] ?? '0001';
  if (verdict === 'denied') return codes[1] ?? codes[0] ?? '0002';
  return codes[0] ?? '0001';
}
