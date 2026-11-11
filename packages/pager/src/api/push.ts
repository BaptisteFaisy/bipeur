/**
 * BIP-F-19 — Web Push, best effort.
 *
 * The service worker is registered by `vite-plugin-pwa`; here we only ask for
 * the subscription the Central needs. Documented fallback: when push is
 * unavailable (no service worker, permission refused, platform without
 * notification actions) the WebSocket stream is enough as long as the pager is
 * open, and a red page always requires the open pager anyway.
 */
export interface PushPort {
  subscribe(): Promise<unknown | null>;
}

export const browserPush: PushPort = {
  async subscribe() {
    const nav = (globalThis as { navigator?: Navigator }).navigator;
    const container = nav?.serviceWorker;
    if (!container || typeof container.register !== 'function') return null;
    try {
      const registration = await container.register('/sw.js');
      const manager = (registration as { pushManager?: PushManager }).pushManager;
      if (!manager) return null;
      const permission = await requestPermission();
      if (permission !== 'granted') return null;
      return await manager.subscribe({ userVisibleOnly: true });
    } catch {
      return null;
    }
  },
};

async function requestPermission(): Promise<NotificationPermission> {
  const Ctor = (globalThis as { Notification?: typeof Notification }).Notification;
  if (!Ctor || typeof Ctor.requestPermission !== 'function') return 'denied';
  return Ctor.requestPermission();
}
