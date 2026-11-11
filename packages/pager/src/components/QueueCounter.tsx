/** BIP-F-16: how many pages are waiting behind the one on the screen. */
import { usePager } from '../state/PagerContext.js';

export function QueueCounter({ count }: { count: number }): React.JSX.Element {
  const { t } = usePager();
  return (
    <span className="queue-counter" data-testid="queue-counter" data-count={count}>
      {count > 0 ? t('pager.queue', { n: count }) : t('pager.queueNone')}
    </span>
  );
}
