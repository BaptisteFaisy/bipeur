/**
 * BIP-F-15 — pairing. The pager asks for the six-character code the Central
 * dashboard shows (or the QR code that encodes it), generates a non-extractable
 * ECDSA P-256 key pair, sends the public half and keeps the private half in
 * memory. When WebCrypto cannot do that, we say so instead of falling back.
 */
import { useState } from 'react';
import { usePager } from '../state/PagerContext.js';

export const CODE_LENGTH = 6;

/** The six-character code, typed by a human who read it on the dashboard. */
function PairingForm(props: {
  code: string;
  onCode(code: string): void;
  onSubmit(): void;
}): React.JSX.Element {
  const { t } = usePager();
  return (
    <form
      className="pairing-form"
      onSubmit={(event) => {
        event.preventDefault();
        props.onSubmit();
      }}
    >
      <label htmlFor="pair-code">{t('pairing.code')}</label>
      <input
        id="pair-code"
        name="code"
        data-testid="pair-code"
        value={props.code}
        inputMode="text"
        autoComplete="off"
        spellCheck={false}
        maxLength={CODE_LENGTH}
        onChange={(event) => props.onCode(normaliseCode(event.target.value))}
      />
      <button type="submit" className="primary">
        {t('pairing.submit')}
      </button>
    </form>
  );
}

export function PairingPanel(): React.JSX.Element {
  const { state, t, pair, go, cryptoSupported } = usePager();
  const [code, setCode] = useState('');

  return (
    <section className="panel" aria-labelledby="pairing-title">
      <h2 id="pairing-title">{t('pairing.title')}</h2>
      <p className="hint">{t('pairing.codeHint')}</p>
      <p className="pairing-state" data-testid="pairing-state">
        {state.device ? t('pairing.paired', { n: 1 }) : t('pairing.none')}
      </p>
      <PairingForm code={code} onCode={setCode} onSubmit={() => void pair(code)} />
      {state.device && (
        <button type="button" className="link" onClick={() => go('pager')}>
          {t('demo.open')}
        </button>
      )}
      <p className="hint" data-testid="pairing-qr-note">
        {t('pairing.qrNote')}
      </p>
      {state.notice !== null && (
        <p className="notice notice-warning" role="status">
          {state.notice}
        </p>
      )}
      {state.error !== null && (
        <p className="notice notice-error" role="alert">
          {state.error}
        </p>
      )}
      {!cryptoSupported && (
        <p className="notice notice-error" data-testid="pairing-unsupported">
          {t('pairing.unsupported')}
        </p>
      )}
    </section>
  );
}

/** Upper case, alphanumeric only: the code is read off a screen and typed once. */
export function normaliseCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, CODE_LENGTH);
}
