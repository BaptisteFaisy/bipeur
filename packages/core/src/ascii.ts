/**
 * ASCII discipline for the pager screen (A.6, BIP-N-08).
 * A page line is printable ASCII only; accents are transliterated.
 */

export const LINE_MAX = 80;
export const LINE_COLS = 20;
export const LINE_ROWS = 4;
export const DETAIL_SCREENS_MAX = 3;

/** Alias of a station: 6 printable characters or less, no space. */
export const ALIAS_MAX = 6;

/** One detail screen (2..4). Screen 4 carries the `AGENT SAYS:` label. */
export interface DetailScreen {
  label: string | null;
  text: string;
}

const TRANSLITERATIONS: Readonly<Record<string, string>> = {
  'æ': 'ae',
  'Æ': 'AE',
  'œ': 'oe',
  'Œ': 'OE',
  'ß': 'ss',
  'ø': 'o',
  'Ø': 'O',
  'đ': 'd',
  'Đ': 'D',
  'ł': 'l',
  'Ł': 'L',
  'ı': 'i',
  'İ': 'I',
  'ğ': 'g',
  'Ğ': 'G',
  'ş': 's',
  'Ş': 'S',
  '€': 'EUR',
  '£': 'GBP',
  '¥': 'JPY',
  '—': '-',
  '–': '-',
  '−': '-',
  '…': '...',
  '’': "'",
  '‘': "'",
  '“': '"',
  '”': '"',
  '‹': '<',
  '›': '>',
  '«': '"',
  '»': '"',
  '•': '*',
  '·': '.',
  '°': 'deg',
  '→': '>',
  '←': '<',
  '⇒': '=>',
  '\u00a0': ' ',
  '\t': ' ',
};

export function isPrintableAsciiChar(code: number): boolean {
  return code >= 0x20 && code <= 0x7e;
}

export function isPrintableAscii(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    if (!isPrintableAsciiChar(text.charCodeAt(i))) return false;
  }
  return true;
}

/**
 * Transliterate to printable ASCII: accents are decomposed, known glyphs are
 * mapped, any other non printable character becomes a space.
 */
export function toAscii(input: string): string {
  const decomposed = input.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  let out = '';
  for (const ch of decomposed) {
    const mapped = TRANSLITERATIONS[ch];
    if (mapped !== undefined) {
      out += mapped;
      continue;
    }
    out += isPrintableAsciiChar(ch.charCodeAt(0)) ? ch : ' ';
  }
  return out;
}

/** Collapse runs of whitespace and trim: a page line is always a single line. */
export function normalizeSpacing(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

export function toLineText(input: string): string {
  return normalizeSpacing(toAscii(input));
}

/** Strip every character that is not printable ASCII, without replacement. */
export function stripNonPrintable(input: string): string {
  let out = '';
  for (const ch of input) {
    if (isPrintableAsciiChar(ch.charCodeAt(0))) out += ch;
  }
  return out;
}

/** Split a line into the 4 rows of 20 columns of a pager screen. */
export function splitScreen(line: string): string[] {
  const rows: string[] = [];
  for (let i = 0; i < LINE_ROWS; i += 1) {
    rows.push(line.slice(i * LINE_COLS, (i + 1) * LINE_COLS));
  }
  return rows;
}

/** Number of characters above the 80-character budget (BIP-F-03). */
export function overflowOf(text: string): number {
  return Math.max(0, text.length - LINE_MAX);
}

export function normalizeAlias(input: string): string {
  const clean = stripNonPrintable(toAscii(input)).replace(/\s+/g, '');
  return clean.slice(0, ALIAS_MAX) || 'agent';
}
