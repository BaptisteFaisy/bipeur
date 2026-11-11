/** Shapes of the MCP adapter. I/O is injected so the tools are testable. */

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Failures are values: a tool decides what an unreachable Central means. */
export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string; timedOut?: boolean };
