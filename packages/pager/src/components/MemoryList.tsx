/** BIP-F-20: the last fifty pages, with the decision and how long it took. */
import { formatDuration } from '@bipeur/core';
import { usePager } from '../state/PagerContext.js';
import type { MemoryEntry } from '../state/types.js';
import { RiskLamp } from './RiskLamp.js';

export function MemoryList(): React.JSX.Element {
  const { state, t } = usePager();
  return (
    <section className="panel" aria-labelledby="memory-title">
      <h2 id="memory-title">{t('memory.title')}</h2>
      {state.memory.length === 0 ? (
        <p className="empty" data-testid="memory-empty">
          {t('memory.empty')}
        </p>
      ) : (
        <ul className="memory-list">
          {state.memory.map((entry) => (
            <MemoryRow key={`${entry.pageId}-${entry.decidedAt}`} entry={entry} />
          ))}
        </ul>
      )}
    </section>
  );
}

function MemoryRow({ entry }: { entry: MemoryEntry }): React.JSX.Element {
  const { t } = usePager();
  const verdict =
    entry.verdict === 'choice'
      ? t('verdict.choice', { code: entry.choice ?? '' })
      : entry.verdict === 'approve'
        ? t('verdict.approve')
        : t('verdict.deny');
  return (
    <li className="memory-row" data-testid="memory-row">
      <RiskLamp risk={entry.risk} />
      <code className="memory-line">{entry.line}</code>
      <span className="memory-verdict">{verdict}</span>
      <span className="memory-latency" title={t('memory.latency')}>
        {formatDuration(entry.latencyMs)}
      </span>
    </li>
  );
}
