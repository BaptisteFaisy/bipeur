/**
 * Test fixtures for the hook: a rules file on disk, a recorded fake `fetch`
 * and the event Kiro would pipe in. No network, no port, no clock
 * (testing.md rules 3, 4 and 6).
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FetchLike } from '../src/types.js';

export const TEST_RULES = `version: 1
defaults: { ttl: 15m, on_expire: deny }
allow:
  - shell: ["pnpm test*"]
deny:
  - shell: ["rm -rf /*", "* | sh"]
page:
  - match: { shell: ["git push*"] }
    code: 310
    risk: amber
    verb: PUSH
fallback: { code: 100, risk: amber }
`;

export function writeRules(text: string = TEST_RULES): string {
  const dir = mkdtempSync(join(tmpdir(), 'bip-hook-'));
  const path = join(dir, 'rules.yaml');
  writeFileSync(path, text, 'utf8');
  return path;
}

export interface RecordedCall {
  url: string;
  method: string;
  body?: unknown;
  authorization: string | undefined;
}

export interface FakeCentral {
  fetchImpl: FetchLike;
  calls: RecordedCall[];
  urls(): string[];
}

/** `handler` answers one request; anything it throws becomes a network error. */
export function fakeCentral(handler: (call: RecordedCall) => Response | Promise<Response>): FakeCentral {
  const calls: RecordedCall[] = [];
  const fetchImpl: FetchLike = async (input, init) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const call: RecordedCall = {
      url: input,
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      authorization: headers['authorization'],
    };
    calls.push(call);
    return handler(call);
  };
  return { fetchImpl, calls, urls: () => calls.map((call) => call.url) };
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export function preToolUse(command: string, overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    hook_event_name: 'PreToolUse',
    cwd: '/repo',
    session_id: 'session-1',
    tool_name: 'shell',
    tool_input: { command },
    ...overrides,
  });
}
