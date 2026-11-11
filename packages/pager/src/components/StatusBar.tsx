/** Top bar: the screen switcher, the clock and the connection state. */
import { usePager } from '../state/PagerContext.js';
import type { Screen } from '../state/types.js';
import { useClock } from './use-clock.js';

const SCREENS: readonly Screen[] = ['pager', 'memory', 'settings', 'pairing', 'demo'];

export function StatusBar(): React.JSX.Element {
  const { state, t, go, now } = usePager();
  const clock = useClock(now);
  return (
    <header className="status-bar">
      <span className="brand">{t('app.name')}</span>
      <nav className="nav" aria-label={t('nav.label')}>
        {SCREENS.map((screen) => (
          <button
            key={screen}
            type="button"
            className={state.screen === screen ? 'nav-item active' : 'nav-item'}
            aria-current={state.screen === screen ? 'page' : undefined}
            onClick={() => go(screen)}
          >
            {t(`nav.${screen}`)}
          </button>
        ))}
      </nav>
      <span className="clock" data-testid="clock">
        {clock}
      </span>
      <span
        className={`connection connection-${state.connection}`}
        data-testid="connection"
        data-connection={state.connection}
      >
        <span className="connection-dot" aria-hidden="true" />
        {t(`status.${state.connection}`)}
      </span>
    </header>
  );
}
