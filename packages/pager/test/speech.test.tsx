/**
 * BIP-N-07 — the read-aloud button speaks the page line through an injected
 * speech port, and the `speech` setting gates it (off at install, BIP-F-21).
 */
import { describe, expect, it } from 'vitest';
import type { SpeechPort } from '../src/api/speech.js';
import { en, fr } from '../src/i18n/index.js';
import { makePage } from './support/fixtures.js';
import { press } from './support/render.js';
import { mountPager } from './support/setup.js';

/** A double of `speechSynthesis`: it records every `speak()` it receives. */
function recordingSpeech(): { spoken: string[]; speech: SpeechPort } {
  const spoken: string[] = [];
  return { spoken, speech: { speak: (text) => void spoken.push(text) } };
}

describe('BIP-N-07 — read the line aloud', () => {
  it('speaks the page line through the injected speech port', async () => {
    const page = makePage();
    const { spoken, speech } = recordingSpeech();
    const ui = await mountPager({ pages: [page], settings: { speech: true }, speech });
    await press(ui.find('read-aloud'));
    expect(spoken).toEqual([page.line]);
    await ui.unmount();
  });

  it('stays silent while the speech setting is off', async () => {
    const page = makePage();
    const { spoken, speech } = recordingSpeech();
    const ui = await mountPager({ pages: [page], speech });
    await press(ui.find('read-aloud'));
    expect(spoken).toEqual([]);
    await ui.unmount();
  });

  it('labels the read-aloud and the setting in both languages', () => {
    expect(en['pager.readAloud']).toBeTruthy();
    expect(fr['pager.readAloud']).toBeTruthy();
    expect(en['settings.speech']).toBeTruthy();
    expect(fr['settings.speech']).toBeTruthy();
    expect(fr['pager.readAloud']).not.toBe(en['pager.readAloud']);
  });
});