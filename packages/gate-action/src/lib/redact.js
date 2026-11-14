/**
 * Secret hygiene (BIP-F-48, SPEC §2 rule 8).
 *
 * The token is an input like any other, so it can leak through a URL the Central
 * echoes back, through a stack trace, or through a fact the workflow typed. Every
 * string that reaches the GitHub log goes through `redact()` with the secret list
 * of the run, and a secret is never printed to say it was wrong — the message
 * names the input, not its value.
 */

/** A secret is never echoed, not even masked partially: one fixed token. */
export const REDACTED = '***';

/**
 * @param {string} text
 * @param {(string|null|undefined)[]} secrets
 * @returns {string}
 */
export function redact(text, secrets) {
  if (typeof text !== 'string' || text.length === 0) return '';
  let out = text;
  for (const secret of secrets) {
    if (typeof secret !== 'string' || secret.length < 4) continue;
    out = out.split(secret).join(REDACTED);
  }
  return out;
}

/**
 * One printable line: the GitHub log reads line by line, and a workflow command
 * must not be smuggled inside a value.
 *
 * @param {string} text
 * @param {number} [max]
 */
export function oneLine(text, max = 300) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/**
 * The secret list of a run: the station token and anything the caller wants
 * hidden as well. Empty strings are dropped so `split('')` never runs.
 *
 * @param {(string|null|undefined)[]} values
 */
export function secretList(values) {
  return values.filter((v) => typeof v === 'string' && v.length >= 4);
}
