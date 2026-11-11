/**
 * A fake Crew Gateway that implements the REAL contract read from the
 * official sources (docs/CREW.md): `POST /api/apps/{name}/token` with
 * `X-App-Secret`, cookie auth `mc_token_<port>`, `/api/ws` frames
 * `{type,data}`, the slot-scoped decide route with its exact refusal codes,
 * the global approval route, `response_id` replay, and the notification push
 * endpoint. A made-up double proves nothing; this one speaks the wire the
 * Gateway speaks, so the relay is tested against the contract, not a stub.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import { WebSocketServer, type WebSocket } from 'ws';

export interface ApprovalRecord {
  id: string;
  instance?: string;
  source?: string;
  tool?: string;
  tool_input?: string;
  tool_purpose?: string;
  slot: string;
  ts?: number;
}

export interface FakeGatewayOptions {
  appSecret?: string;
  /** Set false to reproduce the 403 `session_approval_not_granted`. */
  sessionApproval?: boolean;
  /** The manifest's `permissions.api` prefixes, enforced like the Gateway. */
  apiScope?: string[];
  /** The manifest's `notifications.channels` ids. */
  channels?: string[];
}

export interface ApproveCall {
  path: string;
  body: Record<string, unknown>;
  cookie: string;
}

export interface FakeCrewGateway {
  start(): Promise<void>;
  stop(): Promise<void>;
  readonly baseUrl: string;
  /** Publish an approval and broadcast it to every connected WS client. */
  addApproval(record: ApprovalRecord): void;
  broadcast(type: string, data: Record<string, unknown>): void;
  /** Force-close every WebSocket: the relay must reconnect. */
  dropSockets(): void;
  /** Invalidate issued tokens: the next call answers 401 until re-exchange. */
  expireTokens(): void;
  /** The next `n` approve calls answer 500. */
  failApproveTimes(n: number): void;
  readonly approvals: ApproveCall[];
  readonly notices: Record<string, unknown>[];
  readonly decisions: Map<string, boolean>;
  /** Successful WebSocket handshakes so far. */
  connections(): number;
  /** Requests refused with 401 (missing or expired token). */
  unauthorized(): number;
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')) as Record<string, unknown>);
      } catch {
        resolve({});
      }
    });
  });
}

export function fakeCrewGateway(options: FakeGatewayOptions = {}): FakeCrewGateway {
  const secret = options.appSecret ?? 'test-app-secret';
  const sessionApproval = options.sessionApproval ?? true;
  const apiScope = options.apiScope ?? ['/api/chat/slots'];
  const channels = options.channels ?? ['journal'];

  let server: Server | null = null;
  let wss: WebSocketServer | null = null;
  let base = '';
  let tokenVersion = 1;
  let failApprove = 0;
  let connectionCount = 0;
  let unauthorizedCount = 0;
  const sockets = new Set<WebSocket>();
  const pending = new Map<string, ApprovalRecord>();
  const decisions = new Map<string, boolean>();
  const replayed = new Map<string, { status: number; body: unknown }>();
  const approvals: ApproveCall[] = [];
  const notices: Record<string, unknown>[] = [];

  const json = (res: ServerResponse, status: number, body: unknown): void => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const cookieToken = (req: IncomingMessage): string => {
    const cookie = req.headers.cookie ?? '';
    const match = /mc_token_\d+=([^;]+)/.exec(cookie);
    return match?.[1] ?? '';
  };
  const authed = (req: IncomingMessage): boolean =>
    cookieToken(req) === `tok_v${tokenVersion}` && tokenVersion > 0;
  const inScope = (path: string): boolean => apiScope.some((p) => path === p || path.startsWith(`${p}/`));

  const send = (type: string, data: Record<string, unknown>): void => {
    const frame = JSON.stringify({ type, data });
    for (const socket of sockets) if (socket.readyState === socket.OPEN) socket.send(frame);
  };

  return {
    async start() {
      server = createServer((req, res) => {
        void route(req, res);
      });
      wss = new WebSocketServer({ noServer: true });
      server.on('upgrade', (req, socket, head) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        if (url.pathname !== '/api/ws' || !authed(req)) {
          unauthorizedCount += 1;
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }
        wss?.handleUpgrade(req, socket, head, (ws) => {
          connectionCount += 1;
          sockets.add(ws);
          ws.on('close', () => sockets.delete(ws));
        });
      });
      await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
      const port = (server.address() as AddressInfo).port;
      base = `http://127.0.0.1:${port}`;

      async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
        const url = new URL(req.url ?? '/', base);
        const path = url.pathname;
        const tokenMatch = /^\/api\/apps\/([^/]+)\/token$/.exec(path);
        if (tokenMatch && req.method === 'POST') {
          if (req.headers['x-app-secret'] !== secret) return json(res, 403, { error: 'invalid secret' });
          return json(res, 200, { token: `tok_v${tokenVersion}` });
        }
        if (path === '/api/ws') return json(res, 426, { error: 'upgrade required' });
        if (!authed(req)) {
          unauthorizedCount += 1;
          return json(res, 401, { error: 'token expired' });
        }
        if (path === '/api/notifications/push' && req.method === 'POST') {
          const body = await readBody(req);
          if (!channels.includes(String(body.channel ?? ''))) {
            return json(res, 403, { error: 'channel not declared', code: 'push_channel_not_declared' });
          }
          notices.push(body);
          return json(res, 200, { ok: true });
        }
        const slotApprove = /^\/api\/chat\/slots\/([^/]+)\/approve$/.exec(path);
        if (slotApprove && req.method === 'POST') {
          return approve(res, decodeURIComponent(slotApprove[1] as string), path, req);
        }
        const globalApprove = /^\/api\/approvals\/([^/]+)\/(approve|reject|reject_once)$/.exec(path);
        if (globalApprove && req.method === 'POST') {
          return globalResolve(res, decodeURIComponent(globalApprove[1] as string), globalApprove[2] as string, path, req);
        }
        if (!inScope(path)) return json(res, 403, { error: 'app token out of scope', code: 'app_scope_denied' });
        return json(res, 404, { error: 'not found' });
      }
    },

    async stop() {
      for (const socket of sockets) socket.terminate();
      sockets.clear();
      await new Promise<void>((resolve) => wss?.close(() => resolve()));
      await new Promise<void>((resolve) => server?.close(() => resolve()));
      server = null;
      wss = null;
    },

    get baseUrl() {
      return base;
    },

    addApproval(record) {
      const full: ApprovalRecord = { ts: Date.now() / 1000, ...record };
      pending.set(full.id, full);
      send('approval', full as unknown as Record<string, unknown>);
    },

    broadcast: send,

    dropSockets() {
      for (const socket of sockets) socket.terminate();
      sockets.clear();
    },

    expireTokens() {
      tokenVersion += 1;
    },

    failApproveTimes(n) {
      failApprove = n;
    },

    approvals,
    notices,
    decisions,
    connections: () => connectionCount,
    unauthorized: () => unauthorizedCount,
  };

  async function approve(res: ServerResponse, slot: string, path: string, req: IncomingMessage): Promise<void> {
    const body = await readBody(req);
    approvals.push({ path, body, cookie: req.headers.cookie ?? '' });
    if (failApprove > 0) {
      failApprove -= 1;
      return json(res, 500, { error: 'injected failure' });
    }
    if (!sessionApproval) {
      return json(res, 403, { error: 'app cannot manage session approvals', code: 'session_approval_not_granted' });
    }
    if (!inScope(path)) return json(res, 403, { error: 'app token out of scope', code: 'app_scope_denied' });
    const requestId = String(body.request_id ?? '');
    const responseId = typeof body.response_id === 'string' ? body.response_id : '';
    if (responseId !== '' && replayed.has(responseId)) {
      const past = replayed.get(responseId) as { status: number; body: unknown };
      return json(res, past.status, past.body);
    }
    const record = pending.get(requestId);
    if (record === undefined || record.slot !== slot || decisions.has(requestId)) {
      return json(res, 404, { error: 'no pending approval', code: 'approval_not_pending' });
    }
    const refusal = refuseBadForm(body, record);
    if (refusal !== null) return json(res, refusal.status, refusal.body);
    const approved = body.action === 'approved' || body.action === 'approve';
    settle(requestId, approved, responseId, res);
  }

  function settle(requestId: string, approved: boolean, responseId: string, res: ServerResponse): void {
    const record = pending.get(requestId) as ApprovalRecord;
    pending.delete(requestId);
    decisions.set(requestId, approved);
    send('approval_resolved', { id: requestId, instance: record.instance ?? '', approved, slot: record.slot });
    const outcome = { status: 200, body: { ok: true } };
    if (responseId !== '') replayed.set(responseId, outcome);
    json(res, outcome.status, outcome.body);
  }

  function refuseBadForm(body: Record<string, unknown>, record: ApprovalRecord): { status: number; body: unknown } | null {
    const action = String(body.action ?? '');
    const native = 'origin' in body;
    if ('reason' in body && (!native || (action !== 'rejected' && action !== 'rejected_once'))) {
      return { status: 400, body: { error: 'invalid rejection reason', code: 'invalid_rejection_reason' } };
    }
    if (native) {
      const midOk = body.origin === 'native' && body.request_mid === (record.instance ?? '') && action === 'rejected';
      if (!midOk) return { status: 400, body: { error: 'invalid approval target', code: 'invalid_approval_target' } };
      return null;
    }
    const known = ['approved', 'rejected', 'approve', 'reject', 'trust', 'trust_reads', 'yolo'];
    if (!known.includes(action)) return { status: 400, body: { error: 'unknown action', code: 'unknown_action' } };
    return null;
  }

  async function globalResolve(
    res: ServerResponse,
    id: string,
    action: string,
    path: string,
    req: IncomingMessage,
  ): Promise<void> {
    const body = await readBody(req);
    approvals.push({ path, body, cookie: req.headers.cookie ?? '' });
    if (failApprove > 0) {
      failApprove -= 1;
      return json(res, 500, { error: 'injected failure' });
    }
    if (!sessionApproval) {
      return json(res, 403, { error: 'app cannot manage session approvals', code: 'session_approval_not_granted' });
    }
    const record = pending.get(id);
    if (record === undefined || decisions.has(id)) {
      return json(res, 404, { error: 'no pending approval', code: 'approval_not_pending' });
    }
    settle(id, action === 'approve', '', res);
  }
}
