/**
 * Minimal React 19 harness. The package ships no test renderer, so we drive
 * `react-dom/client` directly: mount, dispatch real DOM events inside `act`,
 * read the tree back through `data-testid`.
 */
import { act } from 'react';
import type { ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Captured before any test installs fake timers: signing a decision resolves on
 * the real macrotask queue, so every interaction ends with a real turn of the
 * loop. Without it an assertion can read the client before `subtle.sign` lands.
 */
const realImmediate: (cb: () => void) => unknown =
  typeof setImmediate === 'function'
    ? (cb) => setImmediate(cb)
    : (cb) => setTimeout(cb, 0);

export interface Harness {
  container: HTMLElement;
  text(): string;
  find(id: string): HTMLElement;
  findAll(id: string): HTMLElement[];
  query(id: string): HTMLElement | null;
  unmount(): Promise<void>;
}

export async function mount(element: ReactElement): Promise<Harness> {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(element);
  });
  await flush();
  const find = (id: string): HTMLElement => {
    const node = container.querySelector(`[data-testid="${id}"]`);
    if (!node) throw new Error(`missing [data-testid="${id}"]`);
    return node as HTMLElement;
  };
  return {
    container,
    find,
    findAll: (id) => Array.from(container.querySelectorAll(`[data-testid="${id}"]`)) as HTMLElement[],
    query: (id) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null,
    text: () => container.textContent ?? '',
    async unmount() {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

/** Let the promise chains started by an effect settle on the real event loop. */
export async function flush(turns = 6): Promise<void> {
  await act(async () => {
    for (let i = 0; i < turns; i += 1) {
      await new Promise<void>((resolve) => {
        realImmediate(resolve);
      });
    }
  });
}

/**
 * Poll a predicate on the real event loop. Signing goes through the platform
 * crypto thread, so the number of turns is not deterministic: we wait for the
 * observable result instead of guessing. Never used to wait for a sound or a
 * network call — only for a promise the app already started.
 */
export async function waitFor(predicate: () => boolean, turns = 800): Promise<void> {
  for (let i = 0; i < turns; i += 1) {
    if (predicate()) return;
    // On a loaded runner (multiple runners in parallel), a WebCrypto thread
    // may take several milliseconds to complete: mix micro-turns and real
    // timers so the loop yields to the system scheduler.
    if (i % 20 === 0) {
      await new Promise<void>((resolve) => realTimeout(resolve, 5));
    }
    await flush(1);
  }
  throw new Error('waitFor: condition never became true');
}

export async function press(element: Element): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await flush();
}

export async function pointer(
  element: Element,
  type: 'pointerdown' | 'pointerup' | 'pointercancel',
): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new window.Event(type, { bubbles: true, cancelable: true }));
  });
  await flush();
}

export async function key(type: 'keydown' | 'keyup', value: string): Promise<void> {
  await act(async () => {
    window.dispatchEvent(new window.KeyboardEvent(type, { key: value, bubbles: true, cancelable: true }));
  });
  await flush();
}

export async function fireWindow(type: 'online' | 'offline'): Promise<void> {
  await act(async () => {
    window.dispatchEvent(new window.Event(type));
  });
}

/** Advance the fake clock; the hold timer is a real interval, just faked. */
export async function advance(ms: number): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
  await flush();
}

/** The nav button of a screen, by its visible label. */
export function navButton(ui: Harness, label: string): HTMLElement {
  const buttons = Array.from(ui.container.querySelectorAll('.nav-item'));
  const found = buttons.find((button) => button.textContent === label);
  if (!found) throw new Error(`missing nav button "${label}"`);
  return found as HTMLElement;
}

/**
 * Type into a controlled input the way a human does. React tracks the value
 * through its own property descriptor, so a plain assignment is swallowed;
 * the native setter plus an `input` event is what actually reaches the state.
 */
export async function typeInto(input: HTMLInputElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value',
  )?.set;
  await act(async () => {
    setter?.call(input, value);
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
  await flush();
}

export async function submit(form: HTMLFormElement): Promise<void> {
  await act(async () => {
    form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  });
  await flush();
}
