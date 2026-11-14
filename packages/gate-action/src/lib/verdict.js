/**
 * The only judgement the gate makes: does this job run, or does it fail?
 * (BIP-F-48). Pure — no fetch, no environment, no `process`.
 *
 * Fail-closed by construction. The gate passes on exactly one answer: a human
 * said `approve` on the pager. Everything else is a failure — a refusal, an
 * expiry, a cancellation, a page still pending when the job deadline passed, an
 * unreachable Central, a verdict the contract does not know. A timeout is never
 * an approval (BIP-F-29), and a simulated verdict is never a human one
 * (BIP-F-42): running a deploy on either would put the job back in blind trust,
 * which is the failure the pager exists to remove.
 */

/** The two outcomes of a gate step. `fail` is the exit-1 path of the job. */
export const OUTCOME = { PASS: 'pass', FAIL: 'fail' };

/** Statuses of `GET /v1/pages/:id/decision` (packages/core/src/schema.ts). */
export const STATUSES = ['approved', 'denied', 'choice', 'expired', 'cancelled', 'pending'];

/** @param {string} reason */
function fail(reason) {
  return { outcome: OUTCOME.FAIL, reason };
}

/** @param {string} reason */
function pass(reason) {
  return { outcome: OUTCOME.PASS, reason };
}

/**
 * Turn the answer of the Central into a job outcome.
 *
 * @param {{status?: string, simulated?: boolean, choice?: string|null, reason?: string|null,
 *   page_id?: string, fingerprint?: string, latency_ms?: number}|null|undefined} wait
 * @param {{allowChoice?: string}} [options] Letter that means "run it" on a
 *   multiple-choice page. Default `A`, so the first seeded option is the yes.
 * @returns {{outcome: 'pass'|'fail', reason: string}}
 */
export function decide(wait, options = {}) {
  const allowChoice = options.allowChoice ?? 'A';
  const status = typeof wait?.status === 'string' ? wait.status : 'unknown';

  if (status === 'approved') {
    // BIP-F-42: shadow mode answers `approved` and says so. A gate that deployed
    // on that would ship without a human ever having seen the page.
    if (wait?.simulated === true) {
      return fail('shadow mode answered for the human — no real decision to deploy on');
    }
    return pass('approved on the pager');
  }
  if (status === 'choice') {
    const choice = wait?.choice ?? null;
    if (choice === allowChoice) return pass(`option ${allowChoice} chosen on the pager`);
    return fail(`the human chose ${choice ?? 'no option'}, not ${allowChoice}`);
  }
  if (status === 'denied') {
    const detail = wait?.reason ? `: ${wait.reason}` : '';
    return fail(`refused on the pager${detail}`);
  }
  if (status === 'cancelled') return fail('the page was cancelled');
  if (status === 'expired') return fail('the page expired — a timeout is never an approval');
  if (status === 'pending') return fail('no decision before the job deadline');
  return fail(`the Central answered a status the contract does not know (${status})`);
}

/**
 * A transport failure is a value, never an approval and never an escaped stack
 * trace — the same rule the hook follows (A.9).
 *
 * @param {string} detail Already redacted by the caller.
 */
export function decideTransport(detail) {
  return fail(`the Central could not be reached (${detail || 'no detail'})`);
}

/** True when a wait answer settles the page: anything but `pending` keeps polling. */
export function isSettled(wait) {
  return wait?.status !== 'pending';
}
