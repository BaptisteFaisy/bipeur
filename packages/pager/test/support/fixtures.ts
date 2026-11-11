/** Deterministic page fixtures: real lines, real fingerprints, no randomness. */
import {
  composeLine,
  type PageOption,
  type PageRecord,
  type Risk,
  type Verb,
} from '@bipeur/core';
import { fingerprint } from '../../../core/src/node.js';

export interface PageFixture {
  id?: string;
  code?: number;
  station?: string;
  verb?: Verb;
  subject?: string;
  risk?: Risk;
  detail?: string[];
  options?: PageOption[];
  callbackUrl?: string | null;
  deliveredAt?: number;
}

export function makePage(input: PageFixture = {}): PageRecord {
  const code = input.code ?? 310;
  const station = input.station ?? 'fw';
  const subject = input.subject ?? 'main>origin 3 commits +120-14';
  const payload = { tool_name: 'shell', command: subject };
  const sha = fingerprint(payload);
  return {
    id: input.id ?? 'pg_1',
    source_id: 'src_1',
    source_alias: station,
    kind: input.options ? 'question' : 'tool',
    code,
    risk: input.risk ?? 'amber',
    line: composeLine({ code, station, verb: input.verb ?? 'PUSH', subject, fingerprint: sha }),
    detail: input.detail ?? [],
    payload,
    payload_sha256: sha,
    options: input.options ?? [],
    state: 'delivered',
    created_at: 1_000_000,
    delivered_at: input.deliveredAt ?? 1_000_000,
    read_at: null,
    expires_at: 9_999_999,
    dedupe_key: `dedupe-${input.id ?? 'pg_1'}`,
    callback_url: input.callbackUrl ?? null,
  };
}

export const THREE_SCREENS = ['a'.repeat(60), 'b'.repeat(60), 'c'.repeat(60)];

export const CHOICES: PageOption[] = [
  { code: 'A', label: 'dayjs' },
  { code: 'B', label: 'luxon' },
  { code: 'C', label: 'temporal' },
];
