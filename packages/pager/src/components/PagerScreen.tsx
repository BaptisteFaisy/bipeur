/**
 * The pager itself: plastic case, 4 × 20 LCD, risk lamp, queue counter, three
 * keys. This is the main screen and it is built for a phone in one hand.
 *
 * Keyboard equivalent of every key (BIP-F-17): Enter approves, Escape refuses,
 * ArrowDown scrolls, A to D pick a pre-seeded reply. On a red page Enter and
 * Escape behave exactly like the on-screen keys: one second of hold.
 */
import { useEffect, useState } from 'react';
import { splitScreen, type PageOption, type Risk } from '@bipeur/core';
import { usePager } from '../state/PagerContext.js';
import { currentPage, detailCount, isQueued } from '../state/reducer.js';
import { HOLD_MS } from '../state/types.js';
import { DetailScreens } from './DetailScreens.js';
import { Keypad } from './Keypad.js';
import { Lcd } from './Lcd.js';
import { QueueCounter } from './QueueCounter.js';
import { RiskLamp } from './RiskLamp.js';
import { useHold } from './use-hold.js';

export function PagerScreen(): React.JSX.Element {
  const { state, t, nextDetail, decide, retry } = usePager();
  const page = currentPage(state);
  const total = detailCount(page);
  const options: readonly PageOption[] = page?.options ?? [];
  const risk: Risk | null = page?.risk ?? null;
  const locked = useVisibilityLock();
  const hold = useHold((action) => void decide(action), HOLD_MS);
  const queued = page !== null && isQueued(state, page.id);

  const detailHidden = locked && state.settings.hideDetailWhenLocked && state.detailIndex > 0;
  const source = displayText(page, state.detailIndex, detailHidden, t);
  const rows = splitScreen(source);

  useDecisionKeys({ risk: risk ?? 'green', options, hold, decide, nextDetail });

  return (
    <section className="pager-screen" aria-label={t('pager.screenLabel')}>
      {state.connection === 'offline' && (
        <p className="banner banner-offline" role="status" data-testid="offline-banner">
          {t('offline.banner')}
        </p>
      )}
      <div className="device">
        <div className="device-top">
          <RiskLamp risk={risk} />
          <QueueCounter count={state.queue.length} />
        </div>
        <Lcd rows={rows} text={page ? source : ''} />
        <PageFooter page={page} index={state.detailIndex} total={total} risk={risk} />
        <Keypad
          risk={risk ?? 'green'}
          options={options}
          hold={hold}
          onApprove={() => void decide('approve')}
          onDeny={() => void decide('deny')}
          onNext={nextDetail}
          onChoose={(code) => void decide('choice', code)}
        />
        {queued && <QueuedNotice onRetry={() => void retry()} />}
        <Notices />
        <p className="keyboard-hint">{t('keyboard.hint')}</p>
      </div>
    </section>
  );
}

/** What sits under the LCD: the detail bar, or the "no pages" line. */
function PageFooter(props: {
  page: ReturnType<typeof currentPage>;
  index: number;
  total: number;
  risk: Risk | null;
}): React.JSX.Element {
  const { t } = usePager();
  return (
    <>
      {props.page ? (
        <DetailScreens page={props.page} index={props.index} total={props.total} />
      ) : (
        <p className="no-pages" data-testid="no-pages">
          {t('pager.noPages')}
        </p>
      )}
      {props.risk === 'red' && (
        <p className="hold-hint" data-testid="hold-hint">
          {t('pager.holdHint')}
        </p>
      )}
    </>
  );
}

/** The decision that did not leave the device, with an explicit retry. */
function QueuedNotice({ onRetry }: { onRetry(): void }): React.JSX.Element {
  const { t } = usePager();
  return (
    <p className="notice notice-warning" role="status" data-testid="queued-notice">
      {t('decision.queued')}{' '}
      <button type="button" className="link" onClick={onRetry}>
        {t('decision.retry')}
      </button>
    </p>
  );
}

/** The error and the notice of the pager, read out loud by a screen reader. */
function Notices(): React.JSX.Element {
  const { state, t } = usePager();
  return (
    <>
      {state.error !== null && (
        <p className="notice notice-error" role="alert" data-testid="error-notice">
          {state.error}
        </p>
      )}
      {state.notice !== null && (
        <p className="notice" role="status" data-testid="notice">
          {state.notice}
        </p>
      )}
      {state.notice === null && state.error === null && (
        <span className="visually-hidden">{t('pager.screenLabel')}</span>
      )}
    </>
  );
}

type Translate = ReturnType<typeof usePager>['t'];

function displayText(
  page: ReturnType<typeof currentPage>,
  index: number,
  detailHidden: boolean,
  t: Translate,
): string {
  if (!page) return t('pager.emptyScreen');
  if (detailHidden) return t('pager.lockedDetail');
  return index > 0 ? (page.detail[index - 1] ?? '') : page.line;
}

interface DecisionKeys {
  risk: Risk;
  options: readonly PageOption[];
  hold: ReturnType<typeof useHold>;
  decide: ReturnType<typeof usePager>['decide'];
  nextDetail: () => void;
}

function useDecisionKeys({ risk, options, hold, decide, nextDetail }: DecisionKeys): void {
  const { begin, end } = hold;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || isTyping(event.target)) return;
      if (event.key === 'Enter') {
        event.preventDefault();
        if (risk === 'red') begin('approve');
        else void decide('approve');
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        if (risk === 'red') begin('deny');
        else void decide('deny');
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        nextDetail();
        return;
      }
      const letter = event.key.toUpperCase();
      if (/^[A-D]$/.test(letter) && options.some((option) => option.code === letter)) {
        event.preventDefault();
        void decide('choice', letter);
      }
    };
    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.key === 'Enter' || event.key === 'Escape') end();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [risk, options, begin, end, decide, nextDetail]);
}

function isTyping(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  const tag = element?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || element?.isContentEditable === true;
}

/** A phone locking its screen hides detail screens when the setting asks for it. */
function useVisibilityLock(): boolean {
  const [locked, setLocked] = useState(isDocumentHidden);
  useEffect(() => {
    const onChange = (): void => setLocked(isDocumentHidden());
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);
  return locked;
}

function isDocumentHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}
