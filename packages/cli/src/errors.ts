/** Errors that the CLI can explain to a human, with a stable kind. */
export class CliError extends Error {
  constructor(
    message: string,
    readonly kind: 'usage' | 'network' | 'status' | 'invalid' = 'usage',
  ) {
    super(message);
    this.name = 'CliError';
  }
}

/** Turn any thrown value into one readable line. Never prints a token. */
export function describeError(error: unknown): string {
  if (error instanceof CliError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}
