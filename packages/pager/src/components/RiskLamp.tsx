/**
 * BIP-F-16: the risk lamp combines a colour and a shape, so the level is never
 * carried by colour alone (BIP-N-05). The text label is the third channel.
 */
import type { Risk } from '@bipeur/core';
import { usePager } from '../state/PagerContext.js';

export function RiskLamp({ risk }: { risk: Risk | null }): React.JSX.Element {
  const { t } = usePager();
  if (risk === null) {
    return (
      <span className="lamp lamp-idle" data-risk="idle" data-testid="risk-lamp" role="img" aria-label={t('pager.emptyScreen')}>
        <span className="lamp-dot" aria-hidden="true" />
        <span className="lamp-text">--</span>
      </span>
    );
  }
  const label = `${t(`risk.${risk}`)} — ${t(`risk.${risk}.hint`)}`;
  return (
    <span
      className={`lamp lamp-${risk}`}
      data-risk={risk}
      data-testid="risk-lamp"
      role="img"
      aria-label={label}
    >
      <LampShape risk={risk} />
      <span className="lamp-text">{t(`risk.${risk}`)}</span>
    </span>
  );
}

/** Circle, diamond, triangle: three silhouettes that survive a grey screenshot. */
function LampShape({ risk }: { risk: Risk }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      {risk === 'green' && <circle cx="12" cy="12" r="9" />}
      {risk === 'amber' && <polygon points="12,2 22,12 12,22 2,12" />}
      {risk === 'red' && <polygon points="12,3 22,21 2,21" />}
    </svg>
  );
}
