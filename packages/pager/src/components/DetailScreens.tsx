/** BIP-F-16 / A.6: which of the four screens is shown, and the way back. */
import type { PageRecord } from '@bipeur/core';
import { usePager } from '../state/PagerContext.js';

export interface DetailScreensProps {
  page: PageRecord;
  /** 0 = the page line, 1..3 = detail screens 2..4. */
  index: number;
  total: number;
}

export function DetailScreens({ page, index, total }: DetailScreensProps): React.JSX.Element {
  const { t } = usePager();
  return (
    <div className="detail-bar">
      <span className="detail-indicator" data-testid="detail-indicator" data-index={index}>
        {index === 0 ? t('pager.detailLine') : t('pager.detail', { n: index + 1, total })}
      </span>
      {page.callback_url !== null && (
        <a
          className="callback"
          data-testid="callback"
          href={page.callback_url}
          title={t('callback.hint')}
          target="_blank"
          rel="noreferrer noopener"
        >
          {t('callback.label')}
        </a>
      )}
    </div>
  );
}
