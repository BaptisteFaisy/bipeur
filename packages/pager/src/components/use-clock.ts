/** The clock of the status bar, driven by the injected clock so tests control it. */
import { useEffect, useState } from 'react';

export function useClock(now: () => number, intervalMs = 1000): string {
  const [value, setValue] = useState(now);
  useEffect(() => {
    const timer = setInterval(() => setValue(now()), intervalMs);
    return () => clearInterval(timer);
  }, [now, intervalMs]);
  return formatClock(value);
}

/** `HH:MM`, local time, always two digits so the LCD width never jumps. */
export function formatClock(timestamp: number): string {
  const date = new Date(timestamp);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
