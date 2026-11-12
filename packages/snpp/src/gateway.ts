/**
 * The SNPP gateway: a `node:net` server, one session per TCP connection.
 *
 * A session speaks RFC 1861 to the client and Beeper to the Central: `SEND`
 * creates a page, the decision arrives asynchronously and the client polls
 * `MSTAtus` until it gets a `888` (or a `780`). Nothing here throws at the
 * client: every line gets an RFC code (BIP-P-11).
 */
import { randomInt } from 'node:crypto';
import { createServer, type Server, type Socket } from 'node:net';
import { LINE_MAX } from '@bipeur/core';
import type { BeeperClient, CreatedPage } from './client.js';
import { LINE_LIMIT, parse, parseUnit, splitLines } from './parser.js';
import { formatReply, formatSnppStamp, REPLIES } from './protocol.js';
import {
  TagRegistry,
  Transaction,
  applyCommand,
  markExpired,
  markRead,
  markReplied,
  replyCodeFor,
  type FiredPage,
  type TagRecord,
  type TxContext,
} from './transaction.js';
import {
  UnitChannel,
  UnitRegistry,
  unitHelpLines,
  type UnitConnection,
} from './unit.js';

export interface GatewayOptions {
  client: BeeperClient;
  /** Credentials required by `LOGIn`, or null on the loopback. */
  credentials?: { id: string; password: string } | null;
  /** Injected clock (`.kiro/steering/testing.md` §3). */
  now?: () => number;
  /** Hours east of Greenwich for the RFC 4.6.10 timestamp. */
  utcOffsetHours?: () => number;
  newTag?: () => string;
  newSecret?: () => string;
  defaultTtlHours?: number;
  maxMessageLength?: number;
  maxChoices?: number;
  idleTimeoutMs?: number;
  /** Client-side refusals allowed before `421 Too Many Errors` (RFC 4.7). */
  maxErrors?: number;
  /** Length of one `GET …/decision?wait=N` call, in seconds. */
  decisionWaitSeconds?: number;
  log?: (line: string) => void;
}

export interface SnppGateway {
  listen(host?: string, port?: number): Promise<{ host: string; port: number }>;
  close(): Promise<void>;
  readonly server: Server;
}

interface Resolved {
  client: BeeperClient;
  credentials: { id: string; password: string } | null;
  now: () => number;
  utcOffsetHours: () => number;
  newTag: () => string;
  newSecret: () => string;
  defaultTtlHours: number;
  maxMessageLength: number;
  maxChoices: number;
  idleTimeoutMs: number;
  maxErrors: number;
  decisionWaitSeconds: number;
  /** The units registered on this gateway, shared by every session. */
  units: UnitRegistry;
  log: (line: string) => void;
}

/** Commands a session may send before `LOGIn`. */
const OPEN_VERBS: ReadonlySet<string> = new Set(['LOGIN', 'HELP', 'QUIT']);

/** What a registered unit may still say to the gateway: `QUIT` and `HELP`. */
const UNIT_SESSION_VERBS: ReadonlySet<string> = new Set(['QUIT', 'HELP']);

/** Four decimal digits: the RFC `Message_Tag` and `Pass_Code` of the example. */
function fourDigits(): string {
  return String(randomInt(0, 10_000)).padStart(4, '0');
}

function resolve(options: GatewayOptions): Resolved {
  return {
    client: options.client,
    credentials: options.credentials ?? null,
    now: options.now ?? (() => Date.now()),
    utcOffsetHours: options.utcOffsetHours ?? (() => -new Date().getTimezoneOffset() / 60),
    newTag: options.newTag ?? fourDigits,
    newSecret: options.newSecret ?? fourDigits,
    defaultTtlHours: options.defaultTtlHours ?? 0.25,
    maxMessageLength: options.maxMessageLength ?? LINE_MAX,
    maxChoices: options.maxChoices ?? 4,
    idleTimeoutMs: options.idleTimeoutMs ?? 300_000,
    maxErrors: options.maxErrors ?? 20,
    decisionWaitSeconds: options.decisionWaitSeconds ?? 25,
    units: new UnitRegistry(),
    log: options.log ?? (() => undefined),
  };
}

function pause(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

/** Status code of a reply line, or 0 when it has none. */
function codeOf(line: string): number {
  const value = Number(line.slice(0, 3));
  return Number.isInteger(value) ? value : 0;
}

/** A refusal the client caused: it counts towards the RFC 4.7 error budget. */
function isClientFault(code: number): boolean {
  return code >= 500 && code < 560;
}

class Session {
  private buffer = '';
  private readonly tx = new Transaction();
  private readonly tags = new TagRegistry();
  private readonly unit: UnitConnection;
  /** The unit channel of this session: the capcode it carries. */
  private readonly channel: UnitChannel;
  private errors = 0;
  private closed = false;
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly socket: Socket,
    private readonly opts: Resolved,
  ) {
    socket.setEncoding('utf8');
    socket.setNoDelay(true);
    socket.on('data', (chunk: string) => this.onData(chunk));
    socket.on('error', () => this.shutdown());
    socket.on('close', () => this.shutdown());
    socket.setTimeout(opts.idleTimeoutMs, () => {
      this.write(formatReply('TIMEOUT'));
      this.socket.end();
    });
    // How the gateway reaches the unit this session carries.
    this.unit = { write: (frame: string): void => this.write(frame) };
    this.channel = new UnitChannel(opts.units, {
      answer: (replies: readonly string[]): void => this.answer(replies),
      now: (): number => opts.now(),
      connection: this.unit,
    });
    this.write(formatReply('READY'));
  }

  /** Release every tag and stop talking: RESEt, QUIT and a closed socket. */
  shutdown(): void {
    if (this.closed) return;
    this.closed = true;
    // The capcode is free again for the next unit.
    this.channel.release();
    this.tags.clear();
    this.tx.reset();
  }

  /** Close the connection for good (server shutdown, idle timeout). */
  destroy(): void {
    this.shutdown();
    this.socket.destroy();
  }

  private write(line: string): void {
    if (this.closed || this.socket.destroyed) return;
    this.socket.write(`${line}\r\n`);
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    if (this.buffer.length > LINE_LIMIT && !/[\r\n]/.test(this.buffer)) {
      // A client that never terminates its line: answer it, do not grow.
      const line = this.buffer;
      this.buffer = '';
      this.enqueue(line);
      return;
    }
    const { lines, rest } = splitLines(this.buffer);
    this.buffer = rest;
    for (const line of lines) this.enqueue(line);
  }

  /** Lines are handled in arrival order, even when one of them awaits HTTP. */
  private enqueue(line: string): void {
    this.chain = this.chain
      .then(() => this.handleLine(line))
      .catch((error: unknown) => this.opts.log(`snpp: session error ${String(error)}`));
  }

  private async handleLine(line: string): Promise<void> {
    if (this.closed) return;
    // The unit channel comes first: `UNIT` and `MCR` are not terminal verbs.
    const unitCommand = parseUnit(line);
    if (unitCommand) {
      if (unitCommand.verb === 'UNIT') this.channel.register(unitCommand.rest);
      else this.channel.answerMcr(unitCommand.rest);
      return;
    }
    const parsed = parse(line);
    if (!parsed.ok) {
      this.answer([`${parsed.error.code} ${parsed.error.text}`]);
      return;
    }
    if (this.channel.registered && !UNIT_SESSION_VERBS.has(parsed.verb)) {
      // A registered unit speaks the unit vocabulary, not the terminal one.
      this.answer([formatReply('BAD_SEQUENCE')]);
      return;
    }
    if (this.channel.registered && parsed.verb === 'HELP') {
      // A unit is told the two commands it owns, not the terminal ones.
      this.answer(unitHelpLines());
      return;
    }
    if (this.opts.credentials && !this.tx.authenticated && !OPEN_VERBS.has(parsed.verb)) {
      this.write(formatReply('LOGIN_REQUIRED'));
      this.socket.end();
      return;
    }
    const online = parsed.verb === 'PAGE' ? await this.pagerOnline(parsed.args[0] ?? '') : true;
    const outcome = applyCommand(this.tx, parsed, this.context(online));
    this.answer(outcome.replies);
    if (outcome.fired) void this.fire(outcome.fired);
    if (outcome.quit) this.socket.end();
  }

  private context(online: boolean): TxContext {
    return {
      now: this.opts.now(),
      online,
      tags: this.tags,
      newTag: this.opts.newTag,
      newSecret: this.opts.newSecret,
      defaultTtlHours: this.opts.defaultTtlHours,
      maxChoices: this.opts.maxChoices,
      maxMessageLength: this.opts.maxMessageLength,
      credentials: this.opts.credentials,
      stamp: (epochMs: number) => formatSnppStamp(epochMs, this.opts.utcOffsetHours()),
    };
  }

  private answer(replies: readonly string[]): void {
    for (const line of replies) {
      this.write(line);
      if (isClientFault(codeOf(line))) this.errors += 1;
      // A tag that just expired: the unit that carries it learns it too.
      if (codeOf(line) === REPLIES.STATUS_EXPIRED.code) this.opts.units.expireStale();
    }
    if (this.errors >= this.opts.maxErrors) {
      this.write(formatReply('TOO_MANY_ERRORS'));
      this.socket.end();
    }
  }

  /** A unit registered under the capcode is online, whoever the Central says. */
  private async pagerOnline(capcode: string): Promise<boolean> {
    if (this.opts.units.isRegistered(capcode)) return true;
    try {
      return await this.opts.client.isOnline();
    } catch {
      return false;
    }
  }

  /** Create the page on the Central, then wait for the human's decision. */
  private async fire(fired: FiredPage): Promise<void> {
    const record = this.tags.get(fired.tag);
    if (!record) return;
    const ttlSeconds = Math.round((fired.expiresAt - this.opts.now()) / 1000);
    try {
      const page = await this.opts.client.createPage({
        pager: fired.pager,
        message: fired.message,
        choices: fired.choices,
        ackRead: fired.ackRead,
        ttlSeconds,
      });
      record.pageId = page.pageId;
      // The unit gets the page of the Central first: it signs its decision
      // against that id, then the line it shows.
      this.deliverToUnit(record, page);
      await this.awaitDecision(record);
      if (this.tx.stage === 'WAIT_REPLY') this.tx.stage = 'DONE';
    } catch (error) {
      // Fail closed: a page the Central never accepted expires (RFC 780).
      markExpired(record, this.opts.now());
      this.opts.units.expireStale();
      this.opts.log(`snpp: tag ${fired.tag} not created: ${String(error)}`);
    }
  }

  /** Push the delivery frames to the unit of the capcode, when there is one. */
  private deliverToUnit(record: TagRecord, page: CreatedPage): void {
    this.opts.units.deliver(record.pager, {
      tag: record.tag,
      secret: record.secret,
      record,
      choices: record.choices,
      expiresAt: record.expiresAt,
      page: { pageId: page.pageId, fingerprint: page.fingerprint },
    });
  }

  private async awaitDecision(record: TagRecord): Promise<void> {
    for (let polls = 0; polls < 1000; polls += 1) {
      if (this.closed) return;
      if (record.status === 'replied') return;
      if (record.status === 'expired') {
        this.opts.units.expireStale();
        return;
      }
      const now = this.opts.now();
      if (now >= record.expiresAt) {
        markExpired(record, now);
        this.opts.units.expireStale();
        return;
      }
      if (record.ackRead) await this.observeRead(record);
      const wait = Math.max(1, Math.min(this.opts.decisionWaitSeconds, Math.ceil((record.expiresAt - now) / 1000)));
      const decision = await this.opts.client.waitDecision(record.pageId ?? '', wait);
      if (decision.status === 'pending') {
        await pause(50);
        continue;
      }
      if (decision.status === 'expired' || decision.status === 'cancelled') {
        markExpired(record, this.opts.now());
        this.opts.units.expireStale();
        return;
      }
      markReplied(record, this.opts.now(), replyCodeFor(record, decision.status, decision.choice));
      return;
    }
  }

  /** `870` needs a read acknowledgement: ask the Central for the page state. */
  private async observeRead(record: TagRecord): Promise<void> {
    const client = this.opts.client;
    if (!client.getPageState || !record.pageId) return;
    const readState = client.getPageState.bind(client);
    let state: string | null = null;
    try {
      state = await readState(record.pageId);
    } catch {
      state = null;
    }
    if (state === 'read' || state === 'decided') markRead(record, this.opts.now());
  }
}

export function createGateway(options: GatewayOptions): SnppGateway {
  const opts = resolve(options);
  const sessions = new Set<Session>();
  const server = createServer({ allowHalfOpen: false }, (socket: Socket) => {
    const session = new Session(socket, opts);
    sessions.add(session);
    socket.on('close', () => sessions.delete(session));
  });

  return {
    server,
    listen(host = '127.0.0.1', port = 4440): Promise<{ host: string; port: number }> {
      return new Promise((done, fail) => {
        server.once('error', fail);
        server.listen(port, host, () => {
          server.removeListener('error', fail);
          const address = server.address();
          const actual = typeof address === 'object' && address ? address.port : port;
          done({ host, port: actual });
        });
      });
    },
    close(): Promise<void> {
      for (const session of sessions) session.destroy();
      sessions.clear();
      return new Promise((done) => server.close(() => done()));
    },
  };
}
