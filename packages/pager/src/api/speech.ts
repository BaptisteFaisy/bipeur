/**
 * BIP-N-07 — read the line aloud.
 *
 * Speech synthesis is the one voice the pager has, and it is never automatic:
 * the read-aloud button is its only caller, the `speech` setting starts off
 * (BIP-F-21) and a page arriving never reads itself. A human gesture is what a
 * screen-reader user and someone with `prefers-reduced-motion` both expect —
 * nothing in this repository speaks behind the user's back.
 *
 * `speechSynthesis` lives on the browser's `window` and is absent from
 * happy-dom, so the access is a port injected exactly like `push`
 * (`api/push.ts`): the default reads the real global, a test hands in a double
 * that records the `speak()` calls.
 */
export interface SpeechPort {
  /** Pronounce `text`; a no-op when speech synthesis is unavailable. */
  speak(text: string): void;
}

/** The slice of the real `SpeechSynthesis` this port needs. */
interface SpeechSynthesisLike {
  cancel(): void;
  speak(utterance: unknown): void;
}

export interface BrowserSpeechOptions {
  synth?: SpeechSynthesisLike | null;
  makeUtterance?: (text: string) => unknown;
}

/** The default: the browser's own `speechSynthesis`, whatever it is worth. */
export function createBrowserSpeech(options: BrowserSpeechOptions = {}): SpeechPort {
  const synth = options.synth ?? browserSynth();
  const makeUtterance = options.makeUtterance ?? browserUtterance;
  return {
    speak(text) {
      if (!synth || typeof synth.speak !== 'function') return;
      // One line at a time, never a queue: a second press restarts the line.
      synth.cancel();
      synth.speak(makeUtterance(text));
    },
  };
}

function browserSynth(): SpeechSynthesisLike | null {
  const synth = (globalThis as { speechSynthesis?: SpeechSynthesis }).speechSynthesis;
  return synth && typeof synth.speak === 'function'
    ? (synth as unknown as SpeechSynthesisLike)
    : null;
}

function browserUtterance(text: string): unknown {
  const Ctor = (globalThis as { SpeechSynthesisUtterance?: new (text: string) => unknown })
    .SpeechSynthesisUtterance;
  return Ctor ? new Ctor(text) : { text };
}

/** The default port: the browser's speech synthesis, read at call time. */
export const browserSpeech: SpeechPort = createBrowserSpeech();