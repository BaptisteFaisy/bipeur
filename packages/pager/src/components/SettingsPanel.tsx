/**
 * BIP-F-21. Every switch starts in its safe position: no sound, no vibration,
 * detail hidden on a locked screen. Nothing here ever plays a sound (BIP-N-06).
 */
import { LANGS, type Lang } from '../i18n/index.js';
import type { Settings } from '../state/types.js';
import { usePager } from '../state/PagerContext.js';

export function SettingsPanel(): React.JSX.Element {
  const { state, t, updateSettings, revoke } = usePager();
  const { settings } = state;
  const onQuietHours = (quietHours: Settings['quietHours']): void => updateSettings({ quietHours });
  return (
    <section className="panel" aria-labelledby="settings-title">
      <h2 id="settings-title">{t('settings.title')}</h2>
      <SafetyToggles />
      <Switch
        id="setting-quiet"
        label={t('settings.quietHours')}
        checked={settings.quietHours.enabled}
        onChange={(enabled) => updateSettings({ quietHours: { ...settings.quietHours, enabled } })}
      />
      <QuietHoursField quietHours={settings.quietHours} onChange={onQuietHours} />
      <NumberField
        id="setting-budget"
        label={t('settings.budget')}
        value={settings.budgetPerHour}
        onChange={(budgetPerHour) => updateSettings({ budgetPerHour })}
      />
      <Switch
        id="setting-hide-detail"
        label={t('settings.hideDetail')}
        hint={t('settings.hideDetailHint')}
        checked={settings.hideDetailWhenLocked}
        onChange={(hideDetailWhenLocked) => updateSettings({ hideDetailWhenLocked })}
      />
      <LanguageField value={settings.lang} onChange={(lang) => updateSettings({ lang })} />
      <DeviceRow onRevoke={revoke} />
    </section>
  );
}

/** BIP-F-21 / BIP-N-07: the three safe-position switches — sound, speech, vibration. */
function SafetyToggles(): React.JSX.Element {
  const { state, t, updateSettings } = usePager();
  const { settings } = state;
  return (
    <>
      <Switch
        id="setting-sound"
        label={t('settings.sound')}
        hint={t('settings.soundHint')}
        checked={settings.sound}
        onChange={(sound) => updateSettings({ sound })}
      />
      <Switch
        id="setting-speech"
        label={t('settings.speech')}
        hint={t('settings.speechHint')}
        checked={settings.speech}
        onChange={(speech) => updateSettings({ speech })}
      />
      <Switch
        id="setting-vibration"
        label={t('settings.vibration')}
        hint={t('settings.vibrationHint')}
        checked={settings.vibration}
        onChange={(vibration) => updateSettings({ vibration })}
      />
    </>
  );
}

/** The two hours of the day when the Central holds the quiet pages. */
function QuietHoursField(props: {
  quietHours: Settings['quietHours'];
  onChange(quietHours: Settings['quietHours']): void;
}): React.JSX.Element {
  const { t } = usePager();
  return (
    <div className="field-row">
      <TimeField
        id="quiet-from"
        label={t('settings.quietFrom')}
        value={props.quietHours.from}
        onChange={(from) => props.onChange({ ...props.quietHours, from })}
      />
      <TimeField
        id="quiet-to"
        label={t('settings.quietTo')}
        value={props.quietHours.to}
        onChange={(to) => props.onChange({ ...props.quietHours, to })}
      />
    </div>
  );
}

/** The device of this pager, and the way to forget it. */


interface SwitchProps {
  id: string;
  label: string;
  hint?: string;
  checked: boolean;
  onChange(checked: boolean): void;
}

function Switch({ id, label, hint, checked, onChange }: SwitchProps): React.JSX.Element {
  return (
    <div className="field">
      <input
        id={id}
        type="checkbox"
        data-testid={id}
        checked={checked}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={(event) => onChange(event.target.checked)}
      />
      <label htmlFor={id}>{label}</label>
      {hint && (
        <p className="hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
    </div>
  );
}

function TimeField(props: { id: string; label: string; value: string; onChange(value: string): void }): React.JSX.Element {
  return (
    <div className="field field-inline">
      <label htmlFor={props.id}>{props.label}</label>
      <input
        id={props.id}
        type="time"
        data-testid={props.id}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
      />
    </div>
  );
}

function NumberField(props: { id: string; label: string; value: number; onChange(value: number): void }): React.JSX.Element {
  return (
    <div className="field field-inline">
      <label htmlFor={props.id}>{props.label}</label>
      <input
        id={props.id}
        type="number"
        data-testid={props.id}
        min={1}
        max={60}
        value={props.value}
        onChange={(event) => props.onChange(Number(event.target.value) || 1)}
      />
    </div>
  );
}

function LanguageField({ value, onChange }: { value: Lang; onChange(lang: Lang): void }): React.JSX.Element {
  const { t } = usePager();
  return (
    <div className="field field-inline">
      <label htmlFor="setting-language">{t('settings.language')}</label>
      <select
        id="setting-language"
        data-testid="setting-language"
        value={value}
        onChange={(event) => onChange(event.target.value as Lang)}
      >
        {LANGS.map((lang) => (
          <option key={lang} value={lang}>
            {lang === 'en' ? 'English' : 'Français'}
          </option>
        ))}
      </select>
    </div>
  );
}

function DeviceRow({ onRevoke }: { onRevoke(): void }): React.JSX.Element {
  const { state, t } = usePager();
  return (
    <div className="field field-inline">
      <span>
        <strong>{t('settings.device')}</strong>{' '}
        <span data-testid="device-state">
          {state.device ? `${state.device.name} (${state.device.id})` : t('settings.none')}
        </span>
      </span>
      {state.device && (
        <button type="button" className="danger" onClick={onRevoke}>
          {t('settings.revoke')}
        </button>
      )}
    </div>
  );
}
