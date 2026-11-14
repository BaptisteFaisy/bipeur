/**
 * The GitHub side of the gate, read from the environment and the event payload
 * the runner writes to `GITHUB_EVENT_PATH` (BIP-F-48).
 *
 * Pure on purpose: `prContext` takes the parsed event object, so a pull request
 * can be tested without a runner and without `@actions/github`. Nothing here
 * reads the token, and nothing here can invent a commit.
 */
import { GateError } from './errors.js';

/** `refs/pull/42/merge` → 42; `refs/heads/main` → `main`. */
export function refParts(ref) {
  const parts = String(ref ?? '').split('/');
  if (parts[1] === 'pull' && parts[2]) return { kind: 'pull', number: parts[2], name: '' };
  if (parts[1] === 'heads' && parts[2]) return { kind: 'head', number: '', name: parts.slice(2).join('/') };
  return { kind: 'other', number: '', name: parts.slice(2).join('/') || String(ref ?? '') };
}

/** `owner/repo` → `repo`, the default station alias of a workflow. */
export function repoShortName(fullName) {
  const text = String(fullName ?? '').trim();
  if (!text) return '';
  return text.split('/').pop() ?? text;
}

/**
 * What a pull-request gate must bind the decision to.
 *
 * The head SHA, not `GITHUB_SHA`: on a `pull_request` event the runner checks
 * out a throwaway merge commit, so signing `GITHUB_SHA` would approve a commit
 * that does not exist on the branch and would not survive a rebase. The head
 * SHA is the code the human actually reviewed.
 *
 * @param {Record<string, any>|null|undefined} event parsed `GITHUB_EVENT_PATH`
 * @param {Record<string, string|undefined>} env
 */
export function prContext(event, env) {
  const pr = event?.pull_request ?? {};
  const refInfo = refParts(env.GITHUB_REF);
  const number = String(event?.number ?? pr.number ?? refInfo.number ?? '').trim();
  const sha = String(pr?.head?.sha ?? event?.after ?? env.GITHUB_SHA ?? '').trim();
  if (!/^[0-9a-f]{7,40}$/i.test(sha)) {
    throw new GateError('no commit to bind the decision to: the event carries no head SHA');
  }
  return {
    number,
    sha: sha.toLowerCase(),
    headRef: String(pr?.head?.ref ?? refInfo.name ?? '').trim(),
    baseRef: String(pr?.base?.ref ?? env.GITHUB_BASE_REF ?? '').trim(),
    repo: String(event?.repository?.full_name ?? env.GITHUB_REPOSITORY ?? '').trim(),
    actor: String(env.GITHUB_ACTOR ?? '').trim(),
    workflow: String(env.GITHUB_WORKFLOW ?? '').trim(),
    runId: String(env.GITHUB_RUN_ID ?? '').trim(),
    attempt: String(env.GITHUB_RUN_ATTEMPT ?? '1').trim(),
  };
}

/**
 * Facts a `gate` step binds a page to: the commit the job is running on, the
 * branch, the workspace. All optional — an absent fact is simply not shown.
 *
 * @param {Record<string, string|undefined>} env
 */
export function jobContext(env) {
  const refInfo = refParts(env.GITHUB_REF);
  return {
    sha: String(env.GITHUB_SHA ?? '').trim().toLowerCase(),
    ref: refInfo.name || refInfo.number || String(env.GITHUB_REF ?? '').trim(),
    repo: String(env.GITHUB_REPOSITORY ?? '').trim(),
    workflow: String(env.GITHUB_WORKFLOW ?? '').trim(),
    runId: String(env.GITHUB_RUN_ID ?? '').trim(),
    workspace: String(env.GITHUB_WORKSPACE ?? '').trim(),
  };
}
