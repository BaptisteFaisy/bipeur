/** Translation entry point: `translate(lang, key, vars)` with `{name}` placeholders. */
import { en, type Dict, type MessageKey } from './en.js';
import { fr } from './fr.js';

export type Lang = 'en' | 'fr';

export const LANGS: readonly Lang[] = ['en', 'fr'];

const DICTS: Readonly<Record<Lang, Dict>> = { en, fr };

export function translate(
  lang: Lang,
  key: MessageKey,
  vars?: Readonly<Record<string, string | number>>,
): string {
  const template = DICTS[lang]?.[key] ?? en[key];
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  );
}

export { en, fr };
export type { Dict, MessageKey };
