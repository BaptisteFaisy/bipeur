import { describe, expect, it } from 'vitest';
import {
  DEFAULTS,
  cookieNameOf,
  endpointOf,
  fillTemplate,
  httpBaseOf,
  loadConfig,
  wsBaseOf,
  wsEndpointOf,
} from '../src/config.js';

describe('crew-app config — the real Gateway contract', () => {
  it('defaults to the documented Gateway address and paths', () => {
    const config = loadConfig({});
    expect(config.gatewayUrl).toBe('http://localhost:5476');
    expect(config.appName).toBe('bipeur');
    expect(config.tokenPath).toBe('/api/apps/{name}/token');
    expect(config.wsPath).toBe('/api/ws');
    expect(config.approvalPath).toBe('/api/chat/slots/{slot}/approve');
    expect(config.globalApprovalPath).toBe('/api/approvals/{id}/{action}');
    expect(config.notificationPath).toBe('/api/notifications/push');
  });

  it('honours KIROCREW_PORT like the official client does', () => {
    expect(loadConfig({ KIROCREW_PORT: '9001' }).gatewayUrl).toBe('http://localhost:9001');
  });

  it('honours KIROCREW_APP_NAME injected by the Gateway backend launcher', () => {
    expect(loadConfig({ KIROCREW_APP_NAME: 'bipeur-dev' }).appName).toBe('bipeur-dev');
  });

  it('keeps environment overrides for tests and odd deployments', () => {
    const config = loadConfig({
      CREW_GATEWAY_URL: 'https://crew.example.org',
      CREW_APPROVAL_PATH: '/custom/approve',
    });
    expect(config.gatewayUrl).toBe('https://crew.example.org');
    expect(config.approvalPath).toBe('/custom/approve');
  });

  it('derives the cookie name from the dialled port', () => {
    expect(cookieNameOf('http://localhost:5476')).toBe('mc_token_5476');
    expect(cookieNameOf('https://crew.example.org')).toBe('mc_token_443');
    expect(cookieNameOf('http://crew.example.org')).toBe('mc_token_80');
    expect(cookieNameOf('ws://127.0.0.1:9100')).toBe('mc_token_9100');
  });

  it('maps the Gateway URL across http and ws schemes', () => {
    expect(httpBaseOf('ws://127.0.0.1:5476/')).toBe('http://127.0.0.1:5476');
    expect(httpBaseOf('wss://crew.example.org')).toBe('https://crew.example.org');
    expect(wsBaseOf('http://127.0.0.1:5476')).toBe('ws://127.0.0.1:5476');
    expect(wsBaseOf('https://crew.example.org')).toBe('wss://crew.example.org');
    expect(endpointOf('ws://h:1', '/api/ws')).toBe('http://h:1/api/ws');
  });

  it('builds the WebSocket endpoint on /api/ws', () => {
    const config = loadConfig({ CREW_GATEWAY_URL: 'http://127.0.0.1:5476' });
    expect(wsEndpointOf(config)).toBe('ws://127.0.0.1:5476/api/ws');
  });

  it('fills path templates and percent-encodes the values', () => {
    expect(fillTemplate(DEFAULTS.approvalPath, { slot: 'slot/1' })).toBe('/api/chat/slots/slot%2F1/approve');
    expect(fillTemplate(DEFAULTS.tokenPath, { name: 'bipeur' })).toBe('/api/apps/bipeur/token');
    expect(fillTemplate(DEFAULTS.globalApprovalPath, { id: 'ap_1', action: 'reject' })).toBe(
      '/api/approvals/ap_1/reject',
    );
  });
});
