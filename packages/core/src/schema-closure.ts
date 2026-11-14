/**
 * The closure of a page (BIP-F-41).
 *
 * An approval used to be the end of the story: the agent got its green light
 * and vanished. A closure is the other half of the loop — the agent *proves*
 * what it did with the decision, and the pager of the human who approved it
 * learns the outcome.
 *
 * The shape is deliberately small. `summary` is the agent's own words (it will
 * land behind the `AGENT SAYS:` label, never in the line); `evidence` is the
 * fact — a commit sha, a PR number, a file list — and the fact is what the
 * line is composed from.
 */
import { z } from 'zod';

export const closureRequestSchema = z.object({
  /** The page that was approved. One page, one closure. */
  page_id: z.string().min(1).max(64),
  /** What the agent did with the decision. Agent prose: labelled as such. */
  summary: z.string().min(1).max(2000),
  /** The verifiable fact: `commit 1a2b3c4`, `PR #87 merged`, `3 files +12-4`. */
  evidence: z.string().max(400).optional(),
});

export type ClosureRequest = z.infer<typeof closureRequestSchema>;

/** The code family of a proof of execution: 8xx, verb DONE (A.6, BIP-F-40). */
export const CLOSURE_CODE = 810;

/**
 * A closure is not a question: nothing waits on it, no callback is attached,
 * and it expires inert. One hour is long enough to be read on a pager and
 * short enough not to clutter the queue.
 */
export const CLOSURE_TTL_MS = 3_600_000;
