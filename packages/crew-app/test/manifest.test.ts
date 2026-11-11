/**
 * The manifest is a contract with the host: this test holds `app.json`
 * against the published manifest reference (kiro.dev/docs/crew/apps/manifest/)
 * and against the paths the relay actually calls — declaration and code must
 * agree, in both directions.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULTS } from '../src/config.js';

const manifest = JSON.parse(
  readFileSync(join(import.meta.dirname, '..', 'app.json'), 'utf-8'),
) as Record<string, unknown>;

const permissions = manifest['permissions'] as {
  api: string[];
  events: string[];
  sessionApproval: boolean;
  network: boolean;
};

/** Every Gateway path the relay calls, with a realistic substitution. */
const calledPaths = [
  DEFAULTS.approvalPath.replace('{slot}', 'slot-1'),
  DEFAULTS.globalApprovalPath.replace('{id}', 'ap_1').replace('{action}', 'approve'),
];

/** `permissions.api` prefix matching, as the Gateway implements it. */
function scopeCovers(pattern: string, path: string): boolean {
  if (pattern.endsWith('/*')) {
    const base = pattern.slice(0, -2);
    return path === base || path.startsWith(`${base}/`);
  }
  if (pattern.endsWith('*')) return path.startsWith(pattern.slice(0, -1));
  return path === pattern || path.startsWith(`${pattern}/`);
}

describe('app.json — required fields of the manifest reference', () => {
  it('declares name, version, displayName and description', () => {
    expect(manifest['name']).toBe('bipeur');
    expect(String(manifest['name'])).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    expect(String(manifest['version'])).toMatch(/^\d+\.\d+\.\d+$/);
    expect(String(manifest['displayName']).length).toBeGreaterThan(0);
    expect(String(manifest['description']).length).toBeGreaterThan(0);
  });

  it('declares the dashboard page the way the host mounts it', () => {
    const ui = manifest['ui'] as { entry: string; pages: { route: string; label: string; entryPoint: string }[] };
    expect(ui.pages).toHaveLength(1);
    expect(ui.pages[0]).toMatchObject({ route: '/apps/bipeur', label: 'Beeper', entryPoint: 'ui/page.mjs' });
    const page = readFileSync(join(import.meta.dirname, '..', 'ui', 'page.mjs'), 'utf-8');
    expect(page).toContain('export function mount');
  });

  it('declares the relay as a node backend', () => {
    const backend = manifest['backend'] as { entryPoint: string; type: string };
    expect(backend).toMatchObject({ entryPoint: 'dist/bin.js', type: 'node' });
  });
});

describe('app.json — permissions stay minimal and honest', () => {
  it('covers every path the relay calls', () => {
    for (const path of calledPaths) {
      expect(permissions.api.some((pattern) => scopeCovers(pattern, path)), `${path} not declared`).toBe(true);
    }
  });

  it('declares nothing beyond the approval family', () => {
    // `/api/notifications/push` needs no declaration: the Gateway allows it
    // implicitly for every app token and enforces the manifest channels in
    // the handler. `/api/ws` and the token exchange are protocol-layer.
    for (const pattern of permissions.api) {
      const approvalFamily = pattern.startsWith('/api/chat/slots') || pattern.startsWith('/api/approvals');
      expect(approvalFamily, `${pattern} is out of the approval family`).toBe(true);
    }
  });

  it('grants session approval and the event scopes the relay listens to', () => {
    expect(permissions.sessionApproval).toBe(true);
    expect(permissions.events).toContain('slots:user');
    expect(permissions.events).toContain('notification:system');
  });

  it('declares the notification channel the journal push uses', () => {
    const notifications = manifest['notifications'] as { channels: { id: string }[] };
    expect(notifications.channels.map((c) => c.id)).toEqual(['journal']);
  });
});
