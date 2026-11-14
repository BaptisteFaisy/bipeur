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
  /** BIP-F-43: a canary page demands the hold, whatever the risk. */
  canary?: boolean;
  options: readonly PageOption[];
  hold: HoldController;
  onApprove(): void;
  onDeny(): void;
  onNext(): void;
  onChoose(code: string): void;
}

export function Keypad(props: KeypadProps): React.JSX.Element {
  const { t } = usePager();
  // BIP-F-43: the reflex guard makes EVERY page holdable, because the point is
  // the reader's habit, not the risk of the page.
  const holdable = props.risk === 'red' || props.canary === true;
  return (
    <div className="keypad">
      <DecisionKey
        variant="deny"
        label={t('key.deny')}
        glyph="✖"
        holdable={holdable}
        hold={props.hold}
        onTap={props.onDeny}
      />
      <button
        type="button"
        className="key key-next"
        data-testid="key-next"
        aria-label={t('key.next')}
        onClick={props.onNext}
      >
        <span className="key-glyph" aria-hidden="true">
          ▼
        </span>
      </button>
      <DecisionKey
        variant="approve"
        label={t('key.approve')}
        glyph="✔"
        holdable={holdable}
        hold={props.hold}
        onTap={props.onApprove}
      />
      <ChoiceKeys options={props.options} canary={props.canary === true} onChoose={props.onChoose} />
      <HoldHint holdable={holdable} canary={props.canary === true} />
    </div>
  );
}

/**
 * The seeded replies. A canary has no one-tap escape hatch: choice keys would
 * bypass the very hold the page exists to demand. The replies remain on the
 * detail screen as facts; the operator approves or refuses deliberately.
 */
function ChoiceKeys(props: {
  options: readonly PageOption[];
  canary: boolean;
  onChoose(code: string): void;
}): React.JSX.Element | null {
  if (props.canary) return null;
  return (
    <>
      {props.options.map((option) => (
        <ChoiceKey key={option.code} option={option} onChoose={props.onChoose} />
      ))}
    </>
  );
}

/** What the deliberate gesture costs, said in the device language. */
function HoldHint(props: { holdable: boolean; canary: boolean }): React.JSX.Element | null {
  const { t } = usePager();
  if (!props.holdable) return null;
  return (
    <>
      <span id="hold-hint" className="visually-hidden">
        {props.canary ? t('pager.canaryHint') : t('pager.holdHint')}
      </span>
      {props.canary && (
        <p className="canary-hint" data-testid="canary-hint" role="status">
          {t('pager.canaryHint')}
        </p>
      )}
    </>
  );
}

interface DecisionKeyProps {
  variant: 'approve' | 'deny';
  label: string;
  glyph: string;
  holdable: boolean;
  hold: HoldController;
  onTap(): void;
}

/** A decision key: one tap, or one second of press-and-hold on a red page. */
function DecisionKey(props: DecisionKeyProps): React.JSX.Element {
  const handlers: ButtonHandlers = props.holdable
    ? holdHandlers(props.hold, props.variant)
    : { onClick: props.onTap };
  const ring = props.hold.action === props.variant ? props.hold.progress : null;
  return (
    <button
      type="button"
      className={`key key-${props.variant}`}
      data-testid={`key-${props.variant}`}
      aria-label={props.label}
      aria-describedby={props.holdable ? 'hold-hint' : undefined}
      {...handlers}
    >
      <span className="key-glyph" aria-hidden="true">
        {props.glyph}
      </span>
      {ring !== null && <HoldRing progress={ring} />}
    </button>
  );
}

function ChoiceKey(props: { option: PageOption; onChoose(code: string): void }): React.JSX.Element {
  const { t } = usePager();
  return (
    <button
      type="button"
      className="key key-choice"
      data-testid={`key-choice-${props.option.code}`}
      aria-label={t('key.choose', { code: props.option.code })}
      onClick={() => props.onChoose(props.option.code)}
    >
      <span className="key-glyph" aria-hidden="true">
        {props.option.code}
      </span>
      <span className="key-label">{props.option.label}</span>
    </button>
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
