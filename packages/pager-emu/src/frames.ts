/**
 * Frames of the **unit channel**: the lines the SNPP gateway pushes to a
 * pager that registered itself with `UNIT <capcode>`.
 *
 * The gateway speaks RFC 1861 to the client and Beeper to the Central; this
 * emulator is the other end of the unit channel, so it reads the frames the
 * gateway sends and answers with the ones of the contract:
 *
 *   gateway -> unit   220, 250, 550, 780, MESS, MCRE, SEND, PAGE
 *   unit -> gateway   UNIT <capcode>, MCR <code>, QUIT
 *
 * `PAGE` is the one frame the contract does not have yet: without the id of
 * the page the Central cannot receive a signed decision (the claims carry
 * `page_id` and `fingerprint`). It is proposed here, in this order:
 *
 *   PAGE <page_id> [<fingerprint>]
 *
 * The fingerprint is optional: when the gateway does not push it, the
 * emulator asks the Central for it (`GET /v1/devices/:id/pages`). Nothing
 * else in the contract changes.
 */

/** What the gateway said. Pure data: no I/O, no state. */
export type GatewayFrame =
  | { kind: 'ready' }
  | { kind: 'ok'; text: string }
  | { kind: 'error'; text: string }
  | { kind: 'page'; pageId: string; fingerprint: string | null }
  | { kind: 'message'; text: string }
  | { kind: 'choice'; code: string; label: string }
  | { kind: 'send'; tag: string; secret: string }
  | { kind: 'expired'; text: string }
  | { kind: 'goodbye'; text: string }
  | { kind: 'unknown'; text: string };

/** The four codes of the contract: `0001` is choice A, `0004` is choice D. */
export const MCR_CODE_PATTERN = /^\d{4}$/;

/** A fingerprint is the 64 hex characters of a SHA-256, as the Central uses. */
const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Parse one line received from the gateway. Never throws: an unknown frame is
 * reported as `unknown`, the way a pager of 1995 ignored what it did not know.
 */
export function parseFrame(raw: string): GatewayFrame {
  const line = raw.replace(/[\r\n]+$/, '').trim();
  if (line.length === 0) return { kind: 'unknown', text: '' };
  if (line.startsWith('220 ')) return { kind: 'ready' };
  if (line.startsWith('250 ')) return { kind: 'ok', text: line.slice(4).trim() };
  if (line.startsWith('221 ')) return { kind: 'goodbye', text: line.slice(4).trim() };
  if (line.startsWith('550 ')) return { kind: 'error', text: line.slice(4).trim() };
  if (line.startsWith('780 ')) return { kind: 'expired', text: line.slice(4).trim() };
  if (line.startsWith('MESS ')) return { kind: 'message', text: line.slice(5).trim() };
  if (line.startsWith('MCRE ')) return parseChoice(line.slice(5).trim());
  if (line.startsWith('SEND ')) return parseSend(line.slice(5).trim());
  if (line.startsWith('PAGE ')) return parsePage(line.slice(5).trim());
  return { kind: 'unknown', text: line };
}

/** `MCRE 0001 Approve` → the code and the label the pager shows. */
function parseChoice(rest: string): GatewayFrame {
  const space = rest.indexOf(' ');
  const code = space === -1 ? rest : rest.slice(0, space);
  const label = space === -1 ? '' : rest.slice(space + 1).trim();
  if (!MCR_CODE_PATTERN.test(code)) return { kind: 'unknown', text: `MCRE ${rest}` };
  return { kind: 'choice', code, label };
}

/** `SEND 4821 7730` → the tag and the secret of the delivery. */
function parseSend(rest: string): GatewayFrame {
  const [tag = '', secret = ''] = rest.split(/\s+/);
  if (tag.length === 0) return { kind: 'unknown', text: `SEND ${rest}` };
  return { kind: 'send', tag, secret };
}

/** `PAGE pg_1f2e3d [<fingerprint>]` → the page of the Central to decide. */
function parsePage(rest: string): GatewayFrame {
  const [pageId = '', fingerprint = ''] = rest.split(/\s+/);
  if (pageId.length === 0) return { kind: 'unknown', text: `PAGE ${rest}` };
  return {
    kind: 'page',
    pageId,
    fingerprint: FINGERPRINT_PATTERN.test(fingerprint) ? fingerprint : null,
  };
}
