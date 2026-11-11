/** BIP-F-31 side of P7: start the demo, then open the pager. */
import { usePager } from '../state/PagerContext.js';

export function DemoPanel(): React.JSX.Element {
  const { state, t, startDemo, go } = usePager();
  return (
    <section className="panel" aria-labelledby="demo-title">
      <h2 id="demo-title">{t('demo.title')}</h2>
      <p className="hint">{t('demo.hint')}</p>
      <div className="button-row">
        <button type="button" className="primary" onClick={() => void startDemo()}>
          {t('demo.start')}
        </button>
        <button type="button" onClick={() => go('pager')}>
          {t('demo.open')}
        </button>
      </div>
      {state.notice !== null && (
        <p className="notice" role="status" data-testid="demo-notice">
          {state.notice}
        </p>
      )}
      {state.error !== null && (
        <p className="notice notice-error" role="alert">
          {state.error}
        </p>
      )}
    </section>
  );
}
