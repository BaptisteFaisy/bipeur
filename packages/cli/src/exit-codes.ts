/**
 * Exit-code contract of `bip` (BIP-F-29). A shell script branches on these
 * numbers, so they are part of the public API: never renumber them.
 */
export const EXIT = {
  /** Yes: approved, or a choice was made. */
  YES: 0,
  /** No: denied or cancelled by the human. */
  NO: 1,
  /** Error: Central unreachable, missing token, invalid arguments. */
  ERROR: 2,
  /** Expired: no decision before the deadline. A timeout is never an approval. */
  EXPIRED: 3,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];
