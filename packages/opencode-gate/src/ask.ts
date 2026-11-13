/**
 * The real ask: the question goes to the pager, the command waits for the
 * human's answer.
 *
 * It is the `bip` CLI — the same binary an agent would call by hand — so the
 * gate pages exactly like the rest of the product: one station, one page, one
 * signed decision, one audit line.
 */
import { spawn } from 'node:child_process';

export type Verdict = 'approved' | 'refused' | 'expired';

export interface AskOptions {
  /** What the human reads on the pager (one line, 80 characters at most). */
  question: string;
  /** The `bip` binary: on the PATH by default. */
  cli?: string;
  /** The Central the page goes to. */
  url?: string;
  /** The station token of the agent. */
  token?: string;
  /** How long the page waits for an answer (`5m`). */
  ttl?: string;
  /** How long the CLI may take before we give up (the TTL plus a margin). */
  timeoutMs?: number;
  /** Called with every line the CLI prints, so the demo can show them. */
  onOutput?: (line: string) => void;
}

/** The exit codes of `bip ask`: 0 yes, 1 no, 3 expired. */
const EXIT_APPROVED = 0;
const EXIT_EXPIRED = 3;

/** Ask the human, and wait. */
export function askHuman(options: AskOptions): Promise<Verdict> {
  const cli = options.cli ?? 'bip';
  const ttl = options.ttl ?? '5m';
  const timeoutMs = options.timeoutMs ?? 6 * 60 * 1000;
  return new Promise((done) => {
    const child = spawn(cli, ['ask', options.question, '--yes-no', '--ttl', ttl], {
      env: {
        ...process.env,
        ...(options.url ? { BIPEUR_URL: options.url } : {}),
        ...(options.token ? { BIPEUR_TOKEN: options.token } : {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const timer = setTimeout(() => {
      child.kill();
      done('expired');
    }, timeoutMs);
    const forward = (chunk: Buffer): void => {
      for (const line of chunk.toString().split('\n')) {
        if (line.trim().length > 0) options.onOutput?.(line);
      }
    };
    child.stdout.on('data', forward);
    child.stderr.on('data', forward);
    child.on('error', () => {
      clearTimeout(timer);
      done('refused');
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === EXIT_APPROVED) return done('approved');
      if (code === EXIT_EXPIRED) return done('expired');
      done('refused');
    });
  });
}
