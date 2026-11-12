/**
 * The unit channel — the half of RFC 1861 that *receives*.
 *
 * A terminal opens a two-way transaction and fires a page; a **unit** is the
 * device the page is delivered to. The unit connects on the same port,
 * registers itself with `UNIT <capcode>`, then receives the delivery frames
 * — `PAGE <page_id> [<fingerprint>]`, `MESS <line>`, one
 * `MCRE <code> <label>` per seeded choice, and `SEND <tag> <secret>` — and
 * answers `MCR <code>`.
 *
 * The registry below lives in the gateway: it maps a capcode to the
 * connection that carries it and to the delivery in progress, so the
 * terminal and the unit speak of the same message through one tag.
 */
import { LINE_MAX, stripNonPrintable } from '@bipeur/core';
import { formatReply, formatReplyAs, UNIT_COMMANDS } from './protocol.js';
import { markReplied, replyCodeFor, type Choice, type TagRecord } from './transaction.js';

/** A capcode is 1 to 20 characters of `[A-Za-z0-9._-]`. */
export const CAPCODE_MAX = 20;

/** A seeded choice shows at most 20 characters on a pager screen. */
export const LABEL_MAX = 20;

/** The four seeded choices of RFC 4.6.7: A, B, C, D. */
const LETTERS = 'ABCD';

/** Is this a well-formed pager id? */
export function isValidCapcode(capcode: string): boolean {
  if (capcode.length < 1 || capcode.length > CAPCODE_MAX) return false;
  for (const ch of capcode) {
    if (!/[A-Za-z0-9._-]/.test(ch)) return false;
  }
  return true;
}

/** Printable ASCII, bounded: what a pager screen can show. */
function printable(text: string, max: number): string {
  return stripNonPrintable(text).slice(0, max).trim();
}

/** The connection a unit speaks on: the gateway writes whole lines to it. */
export interface UnitConnection {
  write(frame: string): void;
}

/** The message on its way to a unit. */
export interface PendingDelivery {
  tag: string;
  secret: string;
  /** The fired page: the tag the terminal polls with `MSTAtus`. */
  record: TagRecord;
  choices: readonly Choice[];
  expiresAt: number;
  /** The page of the Central this message became: the unit signs against it. */
  page: { pageId: string; fingerprint: string };
}

/** A registered unit: its capcode, its connection, the delivery in progress. */
export interface UnitSlot {
  /** The capcode as the unit spelled it. */
  capcode: string;
  /** Lower-case key: a pager id does not depend on the case. */
  key: string;
  connection: UnitConnection;
  delivery: PendingDelivery | null;
}

/** `ok` when the unit is registered, `invalid` or `busy` otherwise. */
export type RegisterOutcome = 'ok' | 'invalid' | 'busy';

/** A fingerprint is the 64 hex characters of a SHA-256, as the Central uses. */
const FINGERPRINT = /^[0-9a-f]{64}$/i;

/**
 * The frame that names the page of the Central: the unit signs its decision
 * against that id (Beeper's addition, `.kiro/steering/rfc1861.md`).
 */
export function pageFrame(page: { pageId: string; fingerprint: string }): string {
  const fingerprint = FINGERPRINT.test(page.fingerprint) ? ` ${page.fingerprint}` : '';
  return `PAGE ${page.pageId}${fingerprint}`;
}

/** The frames pushed to a unit when a message is delivered, in this order. */
export function deliveryFrames(delivery: PendingDelivery): string[] {
  const frames = [pageFrame(delivery.page), `MESS ${printable(delivery.record.message, LINE_MAX)}`];
  for (const choice of delivery.choices) {
    frames.push(`MCRE ${choice.code} ${printable(choice.text, LABEL_MAX)}`.trimEnd());
  }
  frames.push(`SEND ${delivery.tag} ${delivery.secret}`);
  return frames;
}

/**
 * The seeded code an `MCR <code>` answers: the exact seeded code when the unit
 * echoes it, else the positional one (`0001`→A, `0002`→B, `0003`→C,
 * `0004`→D). `null` when the code names no seeded reply.
 */
export function replyCodeForMcr(record: TagRecord, mcrCode: string): string | null {
  const code = mcrCode.trim();
  if (code.length === 0) return null;
  const exact = record.choices.find((choice) => choice.code.toLowerCase() === code.toLowerCase());
  if (exact) return exact.code;
  const digits = /^(\d{4})$/.exec(code);
  if (!digits) return null;
  const index = Number(digits[1]) - 1;
  if (index < 0 || index >= LETTERS.length) return null;
  return replyCodeFor(record, 'choice', LETTERS[index]!);
}

/** The help a unit gets: its own two commands, then `250 OK`. */
export function unitHelpLines(): string[] {
  const lines = UNIT_COMMANDS.map((spec) =>
    formatReplyAs('HELP_LINE', `${spec.usage.padEnd(24)} ${spec.summary}`),
  );
  return [...lines, formatReply('OK')];
}

/** The units known to the gateway: capcode → connection and delivery. */
export class UnitRegistry {
  private readonly slots = new Map<string, UnitSlot>();

  /**
   * Register a connection as the unit of a capcode.
   *
   * `invalid` when the capcode is malformed; `busy` when the capcode is
   * already held by another connection, or when this connection already
   * carries another capcode. Registering the same capcode twice on the same
   * connection is a no-op that succeeds.
   */
  register(capcode: string, connection: UnitConnection): RegisterOutcome {
    if (!isValidCapcode(capcode)) return 'invalid';
    const key = capcode.toLowerCase();
    for (const slot of this.slots.values()) {
      if (slot.connection === connection && slot.key !== key) return 'busy';
    }
    const taken = this.slots.get(key);
    if (taken && taken.connection !== connection) return 'busy';
    this.slots.set(key, { capcode, key, connection, delivery: taken?.delivery ?? null });
    return 'ok';
  }

  /** The connection is gone: the capcode is free again. */
  release(key: string): void {
    this.slots.delete(key.toLowerCase());
  }

  /** The slot of a capcode, when a unit carries it. */
  slot(capcode: string): UnitSlot | undefined {
    return this.slots.get(capcode.toLowerCase());
  }

  /** Is a unit registered under this capcode? */
  isRegistered(capcode: string): boolean {
    return this.slots.has(capcode.toLowerCase());
  }

  /** Push the delivery to the unit of the capcode, when there is one. */
  deliver(capcode: string, delivery: PendingDelivery): boolean {
    const slot = this.slot(capcode);
    if (!slot) return false;
    slot.delivery = delivery;
    for (const frame of deliveryFrames(delivery)) slot.connection.write(frame);
    return true;
  }

  /** The message was answered: the unit has nothing left to reply to. */
  clearDelivery(record: TagRecord): void {
    for (const slot of this.slots.values()) {
      if (slot.delivery?.record === record) slot.delivery = null;
    }
  }

  /** Tell every unit whose message expired that it will never be delivered. */
  expireStale(): void {
    for (const slot of this.slots.values()) {
      const delivery = slot.delivery;
      if (!delivery || delivery.record.status !== 'expired') continue;
      slot.delivery = null;
      slot.connection.write(formatReply('STATUS_EXPIRED'));
    }
  }

  /** How many units are registered. */
  get size(): number {
    return this.slots.size;
  }
}

/** What a session lends to the unit channel it carries. */
export interface UnitHost {
  /** Write the reply lines to the client that speaks the unit channel. */
  answer(replies: readonly string[]): void;
  /** The clock of the gateway, in milliseconds. */
  now(): number;
  /** The connection the gateway pushes the delivery frames to. */
  connection: UnitConnection;
}

/**
 * The unit channel of one session: the capcode it carries, and the two
 * commands it answers — `UNIT <capcode>` and `MCR <code>`.
 */
export class UnitChannel {
  /** The capcode of this session, once it registered as a unit. */
  private key: string | null = null;

  constructor(
    private readonly registry: UnitRegistry,
    private readonly host: UnitHost,
  ) {}

  /** Is this session a registered unit? */
  get registered(): boolean {
    return this.key !== null;
  }

  /** `UNIT <capcode>`: this connection becomes the unit of that capcode. */
  register(capcode: string): void {
    const outcome = this.registry.register(capcode, this.host.connection);
    if (outcome === 'invalid') {
      this.host.answer([formatReply('UNIT_INVALID')]);
      return;
    }
    if (outcome === 'busy') {
      this.host.answer([formatReply('UNIT_BUSY')]);
      return;
    }
    this.key = capcode.toLowerCase();
    this.host.answer([formatReply('UNIT_OK')]);
  }

  /** `MCR <code>`: the unit answers the message it displays. */
  answerMcr(code: string): void {
    const slot = this.key ? this.registry.slot(this.key) : undefined;
    const delivery = slot?.delivery;
    if (!slot || !delivery) {
      this.host.answer([formatReply('MCR_NO_MESSAGE')]);
      return;
    }
    const seeded = replyCodeForMcr(delivery.record, code);
    if (!seeded) {
      this.host.answer([formatReply('MCR_NO_MESSAGE')]);
      return;
    }
    // The tag is concluded: the terminal reads 888 with that code.
    markReplied(delivery.record, this.host.now(), seeded);
    this.registry.clearDelivery(delivery.record);
    this.host.answer([formatReply('MCR_ACCEPTED')]);
  }

  /** The connection is gone: the capcode is free again. */
  release(): void {
    if (this.key) this.registry.release(this.key);
    this.key = null;
  }
}
