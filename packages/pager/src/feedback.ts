/**
 * Haptic feedback. Off at install (BIP-F-21) and never audible: BIP-N-06
 * forbids any sound API in this repository, so this file is the only place a
 * device is allowed to move, and only when the setting is on.
 */
export function pulse(enabled: boolean): void {
  if (!enabled) return;
  const nav = (globalThis as { navigator?: Navigator }).navigator;
  nav?.vibrate?.(180);
}
