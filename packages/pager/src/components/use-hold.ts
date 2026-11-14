/**
 * BIP-F-17: a red page needs one second of press-and-hold. The same controller
 * serves the on-screen keys (pointer) and the keyboard (Enter, Escape, Space),
 * so both paths require the exact same gesture.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { HOLD_MS } from '../state/types.js';

export type HoldAction = 'approve' | 'deny';

export interface HoldController {
  action: HoldAction | null;
  /** 0 to 1, for the progress ring. */
  progress: number;
  begin(action: HoldAction): void;
  end(): void;
}

export function useHold(onComplete: (action: HoldAction, heldMs: number) => void, durationMs = HOLD_MS): HoldController {
  const [state, setState] = useState<{ action: HoldAction | null; progress: number }>({
    action: null,
    progress: 0,
  });
  const complete = useRef(onComplete);
  complete.current = onComplete;

  const stop = useCallback(() => {
    setState({ action: null, progress: 0 });
  }, []);

  const begin = useCallback(
    (next: HoldAction) => {
      setState({ action: next, progress: 0 });
    },
    [],
  );

  const end = useCallback(() => {
    setState((current) => (current.action === null ? current : { action: null, progress: 0 }));
  }, []);

  const done = useCallback(
    (next: HoldAction, heldMs: number) => {
      complete.current(next, heldMs);
      stop();
    },
    [stop],
  );

  useHoldTimer(state.action, durationMs, done);

  return { action: state.action, progress: state.progress, begin, end };
}

/**
 * The one-second countdown. The gesture is measured with the injected clock of
 * the host, so a test drives it with fake timers and never sleeps.
 */
function useHoldTimer(
  action: HoldAction | null,
  durationMs: number,
  onDone: (action: HoldAction, heldMs: number) => void,
): void {
  const startedAt = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (action === null) return undefined;
    startedAt.current = Date.now();
    timer.current = setInterval(() => {
      const ratio = Math.min(1, (Date.now() - startedAt.current) / durationMs);
      if (ratio < 1) return;
      if (timer.current !== null) clearInterval(timer.current);
      timer.current = null;
      onDone(action, Math.max(durationMs, Date.now() - startedAt.current));
    }, 50);
    return () => {
      if (timer.current !== null) clearInterval(timer.current);
      timer.current = null;
    };
  }, [action, durationMs, onDone]);
}
