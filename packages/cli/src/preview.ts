/**
 * `--dry-run`: compose the line locally, send nothing (the spirit of BIP-F-32).
 * The line is only a preview — the Central composes the real one from the
 * payload, and that one is what the pager shows.
 */
import { canonicalize, composeLine, type CreatePageRequest } from '@bipeur/core';
import { createHash } from 'node:crypto';
import type { AskCommand } from './args.js';
import { buildRequest } from './ask.js';

/** Family 5 (design choice) is the family of a question page. */
const QUESTION_CODE = 510;
const PREVIEW_STATION = 'cli';

/**
 * `@bipeur/core/node` is not in the runtime export map of the package, so the
 * two-line hash lives here; `canonicalize` is reused, so the `#hhhh` tag is the
 * one the Central will compute for the same payload.
 */
function fingerprintOf(request: CreatePageRequest): string {
  return createHash('sha256').update(canonicalize(request), 'utf8').digest('hex');
}

export interface Preview {
  request: CreatePageRequest;
  line: string;
}

export function previewAsk(cmd: AskCommand): Preview {
  const request = buildRequest(cmd);
  const line = composeLine({
    code: QUESTION_CODE,
    station: cmd.station ?? PREVIEW_STATION,
    verb: 'PICK',
    subject: cmd.question,
    fingerprint: fingerprintOf(request),
  });
  return { request, line };
}
