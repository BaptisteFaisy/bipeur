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

export function useHold(onComplete: (action: HoldAction) => void, durationMs = HOLD_MS): HoldController {
  const [state, setState] = useState<{ action: HoldAction | null; progress: number }>({
    action: null,
    progress: 0,
  });
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAt = useRef(0);
  const action = useRef<HoldAction | null>(null);
  const complete = useRef(onComplete);
  complete.current = onComplete;

  const stop = useCallback(() => {
    if (timer.current !== null) {
      clearInterval(timer.current);
      timer.current = null;
    }
    action.current = null;
    setState({ action: null, progress: 0 });
  }, []);

  const begin = useCallback(
    (next: HoldAction) => {
      if (action.current === next) return;
      if (timer.current !== null) clearInterval(timer.current);
      action.current = next;
      startedAt.current = Date.now();
      setState({ action: next, progress: 0 });
      timer.current = setInterval(() => {
        const ratio = Math.min(1, (Date.now() - startedAt.current) / durationMs);
        if (ratio < 1) {
          setState({ action: next, progress: ratio });
          return;
        }
        const done = action.current;
        stop();
        if (done) complete.current(done);
      }, 50);
    },
    [durationMs, stop],
  );

  const end = useCallback(() => {
    if (action.current !== null) stop();
  }, [stop]);

  useEffect(
    () => () => {
      if (timer.current !== null) clearInterval(timer.current);
    },
    [],
  );

  return { action: state.action, progress: state.progress, begin, end };
}
