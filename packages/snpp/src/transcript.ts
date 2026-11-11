/**
 * The A.9 demonstration transcript, replayed by `test/transcript.test.ts` and
 * printed by `--help`. One copy: the test also checks that `docs/SNPP.md`
 * quotes exactly these lines.
 */

export type Speaker = 'C' | 'S';

export interface TranscriptLine {
  from: Speaker;
  text: string;
}

/** Epoch of the `888` timestamp below, and the offset it carries (`+1`). */
export const DEMO_NOW = Date.UTC(2026, 10, 24, 22, 14, 55);
export const DEMO_OFFSET_HOURS = 1;
/** Tag and pass code of the example, so the replay is deterministic. */
export const DEMO_TAG = '4821';
export const DEMO_SECRET = '7730';

export const DEMO_TRANSCRIPT: readonly TranscriptLine[] = [
  { from: 'S', text: '220 SNPP (V3) Gateway Ready' },
  { from: 'C', text: '2WAY' },
  { from: 'S', text: '250 OK, Beginning 2-Way Transaction' },
  { from: 'C', text: 'PAGE lea' },
  { from: 'S', text: '850 Two-Way Unit Online and Available; Transaction Accepted' },
  { from: 'C', text: 'ACKR 1' },
  { from: 'S', text: '250 Read Acknowledgment Enabled' },
  { from: 'C', text: 'MESS 310 fw PUSH main>origin 3 commits +120-14 #07c2' },
  { from: 'S', text: '250 Message OK' },
  { from: 'C', text: 'RTYP MULTICHOICE' },
  { from: 'S', text: '250 Reply Type Accepted' },
  { from: 'C', text: 'MCRE 0001 Approve' },
  { from: 'S', text: '250 Response Added to Transaction' },
  { from: 'C', text: 'MCRE 0002 Deny' },
  { from: 'S', text: '250 Response Added to Transaction' },
  { from: 'C', text: 'SEND' },
  { from: 'S', text: '861 4821 7730 Delivered, Awaiting Reply (MCR)' },
  { from: 'C', text: 'MSTA 4821 7730' },
  { from: 'S', text: '888 3 261124231455+1 0001 MCR Reply Received' },
] as const;

/** `S: 220 …` lines, the form used by `--help` and by the documentation. */
export function transcriptLines(lines: readonly TranscriptLine[] = DEMO_TRANSCRIPT): string[] {
  return lines.map((line) => `${line.from}: ${line.text}`);
}

export function formatTranscript(lines: readonly TranscriptLine[] = DEMO_TRANSCRIPT): string {
  return transcriptLines(lines).join('\n');
}
