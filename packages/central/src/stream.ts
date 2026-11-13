/**
 * The WebSocket stream of the pager (`GET /v1/stream`, BIP-F-19 fallback). The
 * device authenticates with its token; a reconnection resynchronises through
 * `GET /v1/devices/:id/pages`, so nothing has to be replayed here.
 */
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import type { StreamMessage } from '@bipeur/core';
import { hashToken } from '@bipeur/core/node';
import { WebSocket, WebSocketServer } from 'ws';
import { CENTRAL_VERSION } from './config.js';
import { bearer } from './http-auth.js';
import type { Store } from './store/types.js';

export interface StreamFilter {
  visitorId?: string | null;
  /** Only these devices (BIP-F-37): a page addressed to one on-call. */
  deviceIds?: string[];
}

export interface StreamHub {
  broadcast(message: StreamMessage, filter?: StreamFilter): void;
  count(): number;
}

export interface WsHubOptions {
  store: Store;
  budgetPerHour: () => number;
}

interface Client {
  deviceId: string;
  visitorId: string | null;
}

export class WsHub implements StreamHub {
  private readonly wss = new WebSocketServer({ noServer: true });
  private readonly clients = new Map<WebSocket, Client>();

  constructor(private readonly options: WsHubOptions) {}

  attach(server: Server): void {
    server.on('upgrade', (request, socket, head) => this.upgrade(request, socket, head));
  }

  count(): number {
    return this.clients.size;
  }

  broadcast(message: StreamMessage, filter: StreamFilter = {}): void {
    const payload = JSON.stringify(message);
    for (const [socket, client] of this.clients) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      if (filter.deviceIds) {
        if (!filter.deviceIds.includes(client.deviceId)) continue;
      } else if (filter.visitorId && client.visitorId !== filter.visitorId) {
        continue;
      }
      socket.send(payload);
    }
  }

  close(): void {
    for (const socket of this.clients.keys()) socket.close();
    this.clients.clear();
    this.wss.close();
  }

  private upgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname !== '/v1/stream') {
      socket.destroy();
      return;
    }
    const token = url.searchParams.get('token') ?? bearer(request.headers.authorization);
    const device = token ? this.options.store.deviceByTokenHash(hashToken(token)) : null;
    if (!device || device.revoked_at !== null) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    this.wss.handleUpgrade(request, socket, head, (ws) => this.register(ws, device.id, device.visitor_id));
  }

  private register(ws: WebSocket, deviceId: string, visitorId: string | null): void {
    this.clients.set(ws, { deviceId, visitorId });
    ws.on('close', () => this.clients.delete(ws));
    ws.on('error', () => this.clients.delete(ws));
    ws.send(
      JSON.stringify({
        type: 'hello',
        central: `bipeur-central/${CENTRAL_VERSION}`,
        budget: this.options.budgetPerHour(),
      }),
    );
  }
}
