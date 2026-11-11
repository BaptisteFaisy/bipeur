import { describe, expect, it } from 'vitest';
import { DEFAULTS, endpointOf, httpBaseOf, loadConfig } from '../src/config.js';
import { parseEvent } from '../src/events.js';

describe('BIP-F-27 — configuration is read, never hard-coded', () => {
  it('falls back to the documented defaults', () => {
    const config = loadConfig({});
    expect(config.gatewayUrl).toBe(DEFAULTS.gatewayUrl);
    expect(config.approvalPath).toBe(DEFAULTS.approvalPath);
    expect(config.notificationPath).toBe(DEFAULTS.notificationPath);
    expect(config.resolveAttempts).toBe(3);
    expect(config.queueLimit).toBe(200);
  });

  it('reads the paths the specification marks as "to verify" from the environment', () => {
    const config = loadConfig({
      CREW_GATEWAY_URL: 'wss://crew.example/ws',
      CREW_APPROVAL_PATH: '/custom/approve',
      CREW_NOTIFICATION_PATH: '/custom/notify',
    });
    expect(config.approvalPath).toBe('/custom/approve');
    expect(config.notificationPath).toBe('/custom/notify');
    expect(endpointOf(config.gatewayUrl, config.approvalPath)).toBe('https://crew.example/ws/custom/approve');
  });

  it('maps the WebSocket scheme to the REST scheme', () => {
    expect(httpBaseOf('ws://127.0.0.1:8790')).toBe('http://127.0.0.1:8790');
    expect(httpBaseOf('wss://crew.example/')).toBe('https://crew.example');
    expect(httpBaseOf('http://127.0.0.1:8790')).toBe('http://127.0.0.1:8790');
  });
});

describe('BIP-F-27 — lenient event parsing', () => {
  it('accepts the canonical shapes', () => {
    expect(parseEvent({ type: 'approval', approval_id: 'ap_1' })).toMatchObject({ approval_id: 'ap_1' });
    expect(parseEvent({ type: 'notification', message: 'hi' })).toMatchObject({ message: 'hi' });
  });

  it('tolerates the aliases the Gateway reference may use', () => {
    expect(parseEvent({ data: { type: 'approval', id: 'ap_2' } })).toMatchObject({ approval_id: 'ap_2' });
    expect(parseEvent({ type: 'notification', line: 'from line' })).toMatchObject({ message: 'from line' });
    expect(parseEvent({ type: 'task_complete', id: 't_2' })).toMatchObject({ task_id: 't_2' });
  });

  it('returns null instead of throwing on anything else', () => {
    expect(parseEvent(null)).toBeNull();
    expect(parseEvent({ type: 'unknown' })).toBeNull();
    expect(parseEvent({ type: 'approval' })).toBeNull();
    expect(parseEvent('nope')).toBeNull();
  });
});
