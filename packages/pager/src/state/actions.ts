/**
 * Async actions of the pager. Each one is a plain function of the runtime
 * context, so the provider stays a thin shell and every action is testable
 * without React.
 */
import type { Verdict } from '@bipeur/core';
import { generateDeviceKeys, supportsDeviceKeys, type DeviceKeys } from '../crypto/device-key.js';
import { translate, type MessageKey } from '../i18n/index.js';
import { buildSignedDecision, DecisionRefused } from './decide.js';
import { currentPage, type Action } from './reducer.js';
import { DEVICE_NAME, errorMessage, toMemoryEntry, type Deps } from './runtime.js';
import { STORAGE_KEYS, writeJson } from './storage.js';
import { MEMORY_LIMIT, type DeviceInfo, type MemoryEntry, type PagerState } from './types.js';

export interface ActionContext {
  deps: Deps;
  dispatch: (action: Action) => void;
  stateRef: { current: PagerState };
  keysRef: { current: DeviceKeys | null };
}

export interface PagerActions {
  decide(verdict: Verdict, choice?: string | null): Promise<void>;
  retry(): Promise<void>;
  pair(code: string): Promise<void>;
  startDemo(): Promise<void>;
  revoke(): void;
  sync(): Promise<void>;
}

export function createActions(ctx: ActionContext): PagerActions {
  return {
    decide: (verdict, choice = null) => decide(ctx, verdict, choice),
    retry: () => retry(ctx),
    pair: (code) => pair(ctx, code),
    startDemo: () => startDemo(ctx),
    revoke: () => revoke(ctx),
    sync: () => sync(ctx),
  };
}

function fail(ctx: ActionContext, key: MessageKey): void {
  ctx.dispatch({ type: 'error', error: translate(ctx.stateRef.current.settings.lang, key) });
}

function persistMemory(ctx: ActionContext, entry: MemoryEntry): void {
  const next = [entry, ...ctx.stateRef.current.memory].slice(0, MEMORY_LIMIT);
  writeJson(ctx.deps.storage, STORAGE_KEYS.memory, next);
}

/**
 * BIP-F-18 + BIP-F-22. The decision is signed first; it is only reported as
 * sent once the Central acknowledged it. Any transport failure queues it and
 * says so — the pager never pretends a decision left the device.
 */
async function decide(ctx: ActionContext, verdict: Verdict, choice: string | null): Promise<void> {
  const snapshot = ctx.stateRef.current;
  const page = currentPage(snapshot);
  if (!page) return;
  const keys = ctx.keysRef.current;
  if (!keys || !ctx.deps.crypto) {
    fail(ctx, 'error.notPaired');
    return;
  }
  let signed;
  try {
    signed = await buildSignedDecision(
      { crypto: ctx.deps.crypto, keys, now: ctx.deps.now },
      page,
      verdict,
      choice,
    );
  } catch (error) {
    const reason = error instanceof DecisionRefused ? error.reason : errorMessage(error);
    ctx.dispatch({
      type: 'error',
      error: translate(snapshot.settings.lang, 'decision.rejected', { reason }),
    });
    return;
  }
  const entry = toMemoryEntry(page, verdict, choice, ctx.deps.now());
  try {
    const ack = await ctx.deps.client.sendDecision(page.id, signed);
    if (ack.status === 'rejected') {
      ctx.dispatch({
        type: 'error',
        error: translate(snapshot.settings.lang, 'decision.rejected', { reason: ack.reason ?? '' }),
      });
      return;
    }
    ctx.dispatch({ type: 'decision.sent', entry });
    persistMemory(ctx, entry);
  } catch {
    ctx.dispatch({
      type: 'decision.queued',
      entry: {
        pageId: page.id,
        claims: signed,
        signature: signed.signature,
        queuedAt: ctx.deps.now(),
      },
    });
  }
}

/** Explicit retry of the outbox: nothing is sent behind the user's back. */
async function retry(ctx: ActionContext): Promise<void> {
  for (const queued of [...ctx.stateRef.current.outbox]) {
    const page = ctx.stateRef.current.queue.find((item) => item.id === queued.pageId);
    if (!page) {
      ctx.dispatch({ type: 'outbox.cleared', pageId: queued.pageId });
      continue;
    }
    try {
      const ack = await ctx.deps.client.sendDecision(queued.pageId, {
        ...queued.claims,
        signature: queued.signature,
      });
      if (ack.status === 'rejected') {
        ctx.dispatch({ type: 'outbox.cleared', pageId: queued.pageId });
        continue;
      }
      const entry = toMemoryEntry(page, queued.claims.verdict, queued.claims.choice, ctx.deps.now());
      ctx.dispatch({ type: 'decision.sent', entry });
      persistMemory(ctx, entry);
    } catch {
      return;
    }
  }
}

/** BIP-F-15: non-extractable key pair, public half sent, id kept locally. */
async function pair(ctx: ActionContext, code: string): Promise<void> {
  const lang = ctx.stateRef.current.settings.lang;
  const clean = code.trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(clean)) {
    ctx.dispatch({ type: 'error', error: translate(lang, 'pairing.invalidCode') });
    return;
  }
  if (!supportsDeviceKeys(ctx.deps.crypto)) {
    ctx.dispatch({ type: 'error', error: translate(lang, 'pairing.unsupported') });
    return;
  }
  try {
    const keys = await generateDeviceKeys(ctx.deps.crypto);
    const pairing = await ctx.deps.client.pair({
      code: clean,
      deviceName: DEVICE_NAME,
      publicKeyJwk: keys.publicKeyJwk,
    });
    const pushSubscription = await ctx.deps.push.subscribe();
    const device = await ctx.deps.client.registerDevice({
      code: clean,
      deviceName: DEVICE_NAME,
      publicKeyJwk: keys.publicKeyJwk,
      pairingId: pairing.pairingId,
      deviceId: pairing.deviceId,
      pushSubscription,
    });
    ctx.keysRef.current = keys;
    const info: DeviceInfo = { id: device.id, name: device.name, pairedAt: device.paired_at };
    writeJson(ctx.deps.storage, STORAGE_KEYS.device, info);
    ctx.dispatch({ type: 'device.paired', device: info });
    await sync(ctx);
  } catch (error) {
    ctx.dispatch({ type: 'error', error: errorMessage(error) });
  }
}

/** Resynchronise the queue from the Central (BIP-F-22). */
async function sync(ctx: ActionContext): Promise<void> {
  const device = ctx.stateRef.current.device;
  if (!device) return;
  try {
    const pages = await ctx.deps.client.fetchPending(device.id);
    ctx.dispatch({ type: 'pages.sync', pages });
  } catch {
    /* offline: whatever is already on screen stays on screen */
  }
}

async function startDemo(ctx: ActionContext): Promise<void> {
  try {
    await ctx.deps.client.startDemo();
    ctx.dispatch({
      type: 'notice',
      notice: translate(ctx.stateRef.current.settings.lang, 'demo.started'),
    });
  } catch (error) {
    ctx.dispatch({ type: 'error', error: errorMessage(error) });
  }
}

function revoke(ctx: ActionContext): void {
  ctx.deps.storage.remove(STORAGE_KEYS.device);
  ctx.deps.storage.remove(STORAGE_KEYS.memory);
  ctx.keysRef.current = null;
  ctx.dispatch({ type: 'device.revoked' });
}
