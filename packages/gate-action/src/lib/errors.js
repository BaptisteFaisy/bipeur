/**
 * The one error type the gate throws (BIP-F-48).
 *
 * A `GateError` message is always safe to print: it is built from input names
 * and statuses, never from a value that could carry a token. `redact.js` is the
 * second line of defence for anything that comes back from the network.
 */
export class GateError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'GateError';
  }
}

/** @param {unknown} value */
export function messageOf(value) {
  if (value instanceof Error && value.message) return value.message;
  if (typeof value === 'string' && value) return value;
  return 'unexpected failure';
}
