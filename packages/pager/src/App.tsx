/**
 * Placeholder shell. The pager lot replaces this with the real device:
 * 4 rows × 20 columns, three keys, risk lamp, queue counter, memory, settings,
 * pairing and the signed-decision flow (BIP-F-15 … BIP-F-23).
 */
export function App(): React.JSX.Element {
  return (
    <main className="shell">
      <h1>Beeper</h1>
      <p>One line. One code. One tap.</p>
      <p className="hint">The pager screen is being wired to the Central.</p>
    </main>
  );
}
