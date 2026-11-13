/**
 * Shapes shared by the hook binaries and their tests. Everything that talks to
 * the outside world — `fetch`, the clock, stderr — is injected, so the whole
 * flow runs in a unit test without a network, a port or a process
 * (testing.md rules 3 and 4).
 */

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Failures are values: every caller decides how to fail closed (BIP-F-24). */
export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string; timedOut?: boolean };

export interface HookOptions {
  rulesPath: string;
  url?: string;
  token?: string;
  /** Station alias shown on the pager line. */
  station: string;
  /** Lifetime of the page; the wait never outlives it (BIP-F-07). */
  ttlMs: number;
  /** Overall cap on the wait, from `--timeout`; defaults to the TTL. */
  timeoutMs?: number;
  /** Long-poll length sent to the Central (`wait=` query parameter). */
  waitSeconds: number;
  dryRun: boolean;
  fetchImpl?: FetchLike;
  now?: () => number;
  log?: (line: string) => void;
}

/** `2` is the only blocking code Kiro understands: the tool is refused. */
export interface HookRunResult {
  code: 0 | 2;
  stdout: string;
  stderr: string;
}

export const OK: HookRunResult = { code: 0, stdout: '', stderr: '' };
