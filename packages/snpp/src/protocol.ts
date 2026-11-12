/**
 * SNPP level 3 (RFC 1861, October 1995): the commands Beeper accepts and the
 * reply codes it may send. Section numbers point at the RFC.
 *
 * Rule 6 of `.kiro/steering/rfc1861.md`: the gateway never invents a reply
 * code, so every code it can emit is listed in `REPLIES` below, with the RFC
 * section that defines it. `isRfcCode` is what property BIP-P-11 checks.
 */

/** The four-letter prefix of a command, upper-cased: the RFC matches on it. */
export type CommandId =
  | '2WAY'
  | 'PAGE'
  | 'MESS'
  | 'RTYP'
  | 'MCRE'
  | 'ACKR'
  | 'EXPT'
  | 'SEND'
  | 'MSTA'
  | 'KTAG'
  | 'RESET'
  | 'QUIT'
  | 'HELP'
  | 'LOGIN';

export interface CommandSpec {
  id: CommandId;
  /** Prefix a client sends, matched case-insensitively (RFC 4.9). */
  prefix: string;
  /** Spelling the RFC uses (`MESSage`, `RTYPe`, …). */
  canonical: string;
  usage: string;
  summary: string;
}

export const COMMANDS: readonly CommandSpec[] = [
  { id: '2WAY', prefix: '2WAY', canonical: '2WAY', usage: '2WAY', summary: 'open a two-way transaction' },
  { id: 'PAGE', prefix: 'PAGE', canonical: 'PAGEr', usage: 'PAGEr <id>', summary: 'select the pager' },
  { id: 'MESS', prefix: 'MESS', canonical: 'MESSage', usage: 'MESSage <line>', summary: 'the page line, a single line' },
  { id: 'RTYP', prefix: 'RTYP', canonical: 'RTYPe', usage: 'RTYPe YESNO|MULTICHOICE', summary: 'expected reply type' },
  { id: 'MCRE', prefix: 'MCRE', canonical: 'MCREsponse', usage: 'MCREsponse <code> <text>', summary: 'seed a multiple-choice reply' },
  { id: 'ACKR', prefix: 'ACKR', canonical: 'ACKRead', usage: 'ACKRead 0|1', summary: 'request a read acknowledgement' },
  { id: 'EXPT', prefix: 'EXPT', canonical: 'EXPTag', usage: 'EXPTag <hours>', summary: 'lifetime of the page, in hours' },
  { id: 'SEND', prefix: 'SEND', canonical: 'SEND', usage: 'SEND', summary: 'fire the page' },
  { id: 'MSTA', prefix: 'MSTA', canonical: 'MSTAtus', usage: 'MSTAtus <tag> <secret>', summary: 'status of a fired page' },
  { id: 'KTAG', prefix: 'KTAG', canonical: 'KTAG', usage: 'KTAG <tag> <secret>', summary: 'release a tag' },
  { id: 'RESET', prefix: 'RESE', canonical: 'RESEt', usage: 'RESEt', summary: 'abandon the transaction' },
  { id: 'QUIT', prefix: 'QUIT', canonical: 'QUIT', usage: 'QUIT', summary: 'close the session' },
  { id: 'HELP', prefix: 'HELP', canonical: 'HELP', usage: 'HELP', summary: 'list the accepted commands' },
  { id: 'LOGIN', prefix: 'LOGI', canonical: 'LOGIn', usage: 'LOGIn <id> <password>', summary: 'authenticate the session' },
] as const;

const BY_PREFIX: ReadonlyMap<string, CommandSpec> = new Map(
  COMMANDS.map((spec) => [spec.prefix, spec] as const),
);

/** The command whose four-letter prefix is `prefix`, or undefined. */
export function commandFor(prefix: string): CommandSpec | undefined {
  return BY_PREFIX.get(prefix);
}

/** Length of the prefix the RFC matches on: `MESS`, `MSTA`, `RESE`, `LOGI`. */
export const COMMAND_PREFIX_LENGTH = 4;

/**
 * The unit channel: the other half of RFC 1861. A *unit* is the device the
 * page is delivered to — a real pager on the other side of the TCP port. It
 * registers itself with `UNIT <capcode>` and answers `MCR <code>`.
 */
export type UnitCommandId = 'UNIT' | 'MCR';

export interface UnitCommandSpec {
  id: UnitCommandId;
  /** Prefix a unit sends, matched case-insensitively, as the RFC does. */
  prefix: string;
  usage: string;
  summary: string;
}

export const UNIT_COMMANDS: readonly UnitCommandSpec[] = [
  {
    id: 'UNIT',
    prefix: 'UNIT',
    usage: 'UNIT <capcode>',
    summary: 'register this connection as the unit of a capcode',
  },
  {
    id: 'MCR',
    prefix: 'MCR',
    usage: 'MCR <code>',
    summary: 'answer the delivered message with one of the seeded codes',
  },
] as const;

const UNIT_BY_PREFIX: ReadonlyMap<string, UnitCommandId> = new Map(
  UNIT_COMMANDS.map((spec) => [spec.prefix, spec.id] as const),
);

/** The unit command whose prefix is `prefix`, or undefined. */
export function unitCommandFor(prefix: string): UnitCommandId | undefined {
  return UNIT_BY_PREFIX.get(prefix);
}

export interface ReplyCode {
  code: number;
  /** Exact text, as written by the RFC (or by the A.9 transcript). */
  text: string;
  /** RFC section that defines it. */
  section: string;
}

/**
 * Every reply the gateway can send. Names are local; codes and texts are the
 * RFC's. `formatReply` puts the parameters (`<tag> <secret>`, `<sequence>`,
 * `<date&time>`) between the code and the text.
 */
export const REPLIES = {
  READY: { code: 220, text: 'SNPP (V3) Gateway Ready', section: '4.1.1' },
  OK: { code: 250, text: 'OK', section: '4.2.3' },
  TWOWAY_STARTED: { code: 250, text: 'OK, Beginning 2-Way Transaction', section: '4.6.1' },
  TWOWAY_UNDERWAY: { code: 550, text: 'Error, Standard Transaction Already Underway, use RESEt', section: '4.6.1' },
  MESSAGE_OK: { code: 250, text: 'Message OK', section: '4.3.2' },
  MESSAGE_DUPLICATE: { code: 503, text: 'ERROR, Message Already Entered', section: '4.3.2' },
  MESSAGE_INVALID: { code: 550, text: 'ERROR, Invalid Message', section: '4.3.2' },
  REPLY_TYPE_ACCEPTED: { code: 250, text: 'Reply Type Accepted', section: '4.6.6' },
  REPLY_TYPE_ILLEGAL: { code: 550, text: 'Illegal Reply Type', section: '4.6.6' },
  MCR_ADDED: { code: 250, text: 'Response Added to Transaction', section: '4.6.7' },
  MCR_INVALID: { code: 550, text: 'Invalid MCResponse Code', section: '4.6.7' },
  MCR_DUPLICATE: { code: 502, text: 'Error! Would Duplicate Previously Entered MCResponse', section: '4.6.7' },
  MCR_NOT_ENABLED: { code: 550, text: 'MCResponses Not Enabled', section: '4.6.7' },
  MCR_TOO_MANY: { code: 552, text: 'Too Many MCResponses Entered', section: '4.6.7' },
  ACK_ENABLED: { code: 250, text: 'Read Acknowledgment Enabled', section: '4.6.5' },
  ACK_DISABLED: { code: 250, text: 'Read Acknowledgment Disabled', section: '4.6.5' },
  EXPIRY_CHANGED: { code: 250, text: 'Message Expiry Time Changed', section: '4.6.3' },
  RESET_OK: { code: 250, text: 'RESET OK', section: '4.3.3' },
  TAG_RELEASED: { code: 250, text: 'OK, Message Tag Released', section: '4.6.10' },
  QUIT_OK: { code: 221, text: 'OK, Goodbye', section: '4.1.2' },
  LOGIN_ACCEPTED: { code: 250, text: 'Login Accepted', section: '4.5.1' },
  LOGIN_REFUSED: { code: 550, text: 'Error, Invalid LoginID or Password', section: '4.5.1' },
  LOGIN_REQUIRED: { code: 421, text: 'Illegal Access Attempt, LOGIn Required', section: '4.5.1' },
  UNIT_ONLINE: { code: 850, text: 'Two-Way Unit Online and Available; Transaction Accepted', section: '4.6.8' },
  UNIT_QUEUED: { code: 950, text: 'Unit NOT Online; Message Will Be Queued for Later Delivery', section: '4.6.8' },
  PAGER_ALREADY: { code: 503, text: 'Already Selected PAGEr', section: '4.6.8' },
  SENT_AWAITING_REPLY: { code: 861, text: 'Delivered, Awaiting Reply (MCR)', section: '4.6.9' },
  STATUS_AWAITING_REPLY: { code: 861, text: 'Delivered, Awaiting Reply (MCR)', section: '4.6.10' },
  STATUS_READ: { code: 870, text: 'Delivered, Read, Awaiting Reply (MCR)', section: '4.6.10' },
  STATUS_REPLY: { code: 888, text: 'MCR Reply Received', section: '4.6.10' },
  STATUS_EXPIRED: { code: 780, text: 'MESSAGE EXPIRED Before Delivery!', section: '4.6.10' },
  // The unit channel: a pager that receives (RFC 4.6.8, §4.6.9). Only the
  // codes 250 and 550 of the RFC are used, never an invented one.
  UNIT_OK: { code: 250, text: 'OK, Unit Registered', section: '4.6.8' },
  UNIT_INVALID: { code: 550, text: 'ERROR, Invalid Pager ID', section: '4.6.8' },
  UNIT_BUSY: { code: 550, text: 'ERROR, Unit Already Registered', section: '4.6.8' },
  MCR_ACCEPTED: { code: 250, text: 'OK, Response Accepted', section: '4.6.9' },
  MCR_NO_MESSAGE: { code: 550, text: 'ERROR, No Message Awaiting Reply', section: '4.6.9' },
  UNKNOWN_TAG: { code: 550, text: 'Unknown or Illegal Message_Tag or Pass_Code', section: '4.6.10' },
  BAD_SEQUENCE: { code: 503, text: 'Bad Sequence of Commands', section: '4.2.6' },
  INCOMPLETE: { code: 503, text: 'Error, Pager ID or Message Incomplete', section: '4.3.4' },
  SYNTAX: { code: 501, text: 'Syntax Error in Command or Argument', section: '4.2.5' },
  TOO_MANY_ERRORS: { code: 421, text: 'Too Many Errors, Goodbye', section: '4.7' },
  TIMEOUT: { code: 421, text: 'Timeout, Goodbye', section: '4.8' },
  SERVICE_CLOSING: { code: 421, text: 'Service Closing, Goodbye', section: '4.2.4' },
  HELP_LINE: { code: 214, text: '', section: '4.2.1' },
} as const satisfies Record<string, ReplyCode>;

export type ReplyName = keyof typeof REPLIES;

/** The distinct numeric codes the gateway can send. */
export const RFC_CODES: ReadonlySet<number> = new Set(
  Object.values(REPLIES).map((reply) => reply.code),
);

export function isRfcCode(code: number): boolean {
  return RFC_CODES.has(code);
}

/**
 * `<code> <params…> <text>`, the shape of every SNPP reply line.
 * A reply without text (214 help lines) ends at the parameters.
 */
export function formatReply(name: ReplyName, params: readonly string[] = []): string {
  return formatReplyParts(REPLIES[name], params);
}

export function formatReplyParts(reply: ReplyCode, params: readonly string[] = []): string {
  const head = [String(reply.code), ...params].join(' ');
  return reply.text ? `${head} ${reply.text}` : head;
}

/** Same reply code, different wording: `250` carries a per-command text. */
export function formatReplyAs(name: ReplyName, text: string, params: readonly string[] = []): string {
  return formatReplyParts({ ...REPLIES[name], text }, params);
}

/** Parameters of a reply line, e.g. `['4821', '7730']` in `861 4821 7730 Delivered…`. */
export function replyParams(line: string): string[] {
  const parts = line.trim().split(/\s+/);
  return parts.slice(1);
}

/**
 * RFC 4.6.10 timestamp: `YYMMDDHHMMSS+GMT`, e.g. `261124231455+1` for
 * 24 November 2026, 23:14:55, one hour east of Greenwich.
 */
export function formatSnppStamp(epochMs: number, offsetHours: number): string {
  const shifted = new Date(epochMs + offsetHours * 3_600_000);
  const pad = (value: number): string => String(value).padStart(2, '0');
  const stamp = [
    pad(shifted.getUTCFullYear() % 100),
    pad(shifted.getUTCMonth() + 1),
    pad(shifted.getUTCDate()),
    pad(shifted.getUTCHours()),
    pad(shifted.getUTCMinutes()),
    pad(shifted.getUTCSeconds()),
  ].join('');
  const sign = offsetHours >= 0 ? '+' : '-';
  return `${stamp}${sign}${Math.abs(offsetHours)}`;
}
