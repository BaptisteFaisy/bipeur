/**
 * BIP-F-17: three keys (approve, refuse, next) plus A to D when the page
 * carries pre-seeded replies. On a red page the two decision keys need one
 * second of press-and-hold; a quick tap does nothing at all.
 */
import type { PageOption, Risk } from '@bipeur/core';
import { usePager } from '../state/PagerContext.js';
import type { HoldAction, HoldController } from './use-hold.js';

type ButtonHandlers = Pick<
  React.ComponentProps<'button'>,
  'onClick' | 'onPointerDown' | 'onPointerUp' | 'onPointerCancel' | 'onKeyDown' | 'onKeyUp'
>;

export interface KeypadProps {
  risk: Risk;
  options: readonly PageOption[];
  hold: HoldController;
  onApprove(): void;
  onDeny(): void;
  onNext(): void;
  onChoose(code: string): void;
}

export function Keypad(props: KeypadProps): React.JSX.Element {
  const { t } = usePager();
  const holdable = props.risk === 'red';
  const approve: ButtonHandlers = holdable
    ? holdHandlers(props.hold, 'approve')
    : { onClick: props.onApprove };
  const deny: ButtonHandlers = holdable
    ? holdHandlers(props.hold, 'deny')
    : { onClick: props.onDeny };

  return (
    <div className="keypad">
      <button
        type="button"
        className="key key-deny"
        data-testid="key-deny"
        aria-label={t('key.deny')}
        aria-describedby={holdable ? 'hold-hint' : undefined}
        {...deny}
      >
        <span className="key-glyph" aria-hidden="true">
          ✖
        </span>
        {props.hold.action === 'deny' && <HoldRing progress={props.hold.progress} />}
      </button>
      <button type="button" className="key key-next" data-testid="key-next" aria-label={t('key.next')} onClick={props.onNext}>
        <span className="key-glyph" aria-hidden="true">
          ▼
        </span>
      </button>
      <button
        type="button"
        className="key key-approve"
        data-testid="key-approve"
        aria-label={t('key.approve')}
        aria-describedby={holdable ? 'hold-hint' : undefined}
        {...approve}
      >
        <span className="key-glyph" aria-hidden="true">
          ✔
        </span>
        {props.hold.action === 'approve' && <HoldRing progress={props.hold.progress} />}
      </button>
      {props.options.map((option) => (
        <button
          type="button"
          key={option.code}
          className="key key-choice"
          data-testid={`key-choice-${option.code}`}
          aria-label={t('key.choose', { code: option.code })}
          onClick={() => props.onChoose(option.code)}
        >
          <span className="key-glyph" aria-hidden="true">
            {option.code}
          </span>
          <span className="key-label">{option.label}</span>
        </button>
      ))}
      {holdable && (
        <span id="hold-hint" className="visually-hidden">
          {t('pager.holdHint')}
        </span>
      )}
    </div>
  );
}

function holdHandlers(hold: HoldController, action: HoldAction): ButtonHandlers {
  const start = (event: React.SyntheticEvent): void => {
    event.preventDefault();
    hold.begin(action);
  };
  const stop = (): void => hold.end();
  const isTrigger = (key: string): boolean => key === ' ' || key === 'Enter';
  return {
    onPointerDown: start,
    onPointerUp: stop,
    onPointerCancel: stop,
    onKeyDown: (event) => {
      if (isTrigger(event.key)) start(event);
    },
    onKeyUp: (event) => {
      if (isTrigger(event.key)) stop();
    },
  };
}

/** The visible one-second progress ring; `prefers-reduced-motion` turns it static. */
function HoldRing({ progress }: { progress: number }): React.JSX.Element {
  const circumference = 2 * Math.PI * 18;
  return (
    <svg className="hold-ring" viewBox="0 0 44 44" aria-hidden="true" focusable="false">
      <circle className="ring-track" cx="22" cy="22" r="18" />
      <circle
        className="ring-fill"
        cx="22"
        cy="22"
        r="18"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - progress)}
      />
    </svg>
  );
}
