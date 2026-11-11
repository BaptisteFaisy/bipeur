/**
 * BIP-F-16: the liquid crystal display. Four rows of twenty columns, drawn in
 * a matrix font. The matrix is decorative; the real, selectable, screen-reader
 * readable text sits underneath (BIP-N-05).
 */
import { LINE_COLS, LINE_ROWS } from '@bipeur/core';

export interface LcdProps {
  /** At most four rows; missing rows are blank. */
  rows: readonly string[];
  /** What a screen reader reads instead of the character grid. */
  text: string;
}

export function Lcd({ rows, text }: LcdProps): React.JSX.Element {
  const grid = Array.from({ length: LINE_ROWS }, (_, index) =>
    (rows[index] ?? '').slice(0, LINE_COLS).padEnd(LINE_COLS, ' '),
  );
  return (
    <div className="lcd" data-testid="lcd">
      <div className="lcd-matrix" aria-hidden="true">
        {grid.map((row, index) => (
          <div className="lcd-row" data-testid="lcd-row" key={index}>
            {row}
          </div>
        ))}
      </div>
      <p className="visually-hidden" data-testid="lcd-text">
        {text}
      </p>
    </div>
  );
}
