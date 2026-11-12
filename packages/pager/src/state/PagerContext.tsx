/**
 * The pager's single source of truth: one reducer, one context, one place
 * where the stream, the clock and the network meet.
 */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from 'react';
import type { Verdict } from '@bipeur/core';
import { translate, type MessageKey } from '../i18n/index.js';
import { supportsDeviceKeys, type CryptoPort, type DeviceKeys } from '../crypto/device-key.js';
import type { CentralClient } from '../api/client.js';
import type { PushPort } from '../api/push.js';
import { createActions, type PagerActions } from './actions.js';
import { clearAutoPairFromLocation, resolveAutoPair } from './auto-pair.js';
import { reducer } from './reducer.js';
import { createDeps, hydrateState, type Deps, type RuntimeInput, type StateOverrides } from './runtime.js';
import { handleStream } from './stream.js';
import {
  listenForServiceWorker,
  readOpenRequest,
  targetPage,
  verdictOf,
} from './service-worker.js';
import { STORAGE_KEYS, writeJson, type StoragePort } from './storage.js';
import type { PagerState, Screen, Settings } from './types.js';

export interface PagerApi {
  state: PagerState;
  t(key: MessageKey, vars?: Readonly<Record<string, string | number>>): string;
  go(screen: Screen): void;
  nextDetail(): void;
  updateSettings(patch: Partial<Settings>): void;
  decide(verdict: Verdict, choice?: string | null): Promise<void>;
  retry(): Promise<void>;
  pair(code: string): Promise<void>;
  startDemo(): Promise<void>;
  revoke(): void;
  /** False when the browser cannot create a non-extractable ECDSA P-256 key. */
  cryptoSupported: boolean;
  /** The injected clock: every time-dependent screen reads it from here. */
  now(): number;
}

export interface PagerProviderProps extends RuntimeInput {
  children: ReactNode;
  /** Skip pairing in tests and demos by handing the keys straight in. */
  deviceKeys?: DeviceKeys | null;
  initialState?: StateOverrides;
}

const PagerContext = createContext<PagerApi | null>(null);

export function PagerProvider(props: PagerProviderProps): React.JSX.Element {
  const depsRef = useRef<Deps | null>(null);
  if (depsRef.current === null) depsRef.current = createDeps(props);
  const deps = depsRef.current;

  const [state, dispatch] = useReducer(reducer, props.initialState, (overrides) =>
    hydrateState(overrides, deps.storage),
  );
  const stateRef = useRef(state);
  stateRef.current = state;
  // The client reads the token live: a device hydrated from storage (or paired
  // a moment ago) must be usable by the very next request and by the socket.
  deps.deviceToken.current = state.device?.token ?? null;
  const keysRef = useRef<DeviceKeys | null>(props.deviceKeys ?? null);
  const actions = useMemo<PagerActions>(
    () => createActions({ deps, dispatch, stateRef, keysRef }),
    [deps],
  );

  // The token is a dependency: pairing (or starting the demo) hands one over,
  // and only then can the socket authenticate. Without it the stream would
  // stay offline for the life of the tab.
  useStream(deps, dispatch, stateRef, state.device?.token ?? null);
  useNetworkListeners(dispatch);
  useServiceWorkerActions(actions, stateRef);
  useOpenRequest(actions, dispatch, stateRef);
  useBoot(actions, dispatch, stateRef, keysRef);
  useAutoPair(actions, stateRef);

  const api = useMemo<PagerApi>(
    () => buildApi(state, deps, actions, dispatch, stateRef),
    [state, deps, actions, dispatch, stateRef],
  );

  return <PagerContext.Provider value={api}>{props.children}</PagerContext.Provider>;
}

export function usePager(): PagerApi {
  const api = useContext(PagerContext);
  if (!api) throw new Error('usePager must be used inside <PagerProvider>');
  return api;
}

type Dispatch = (action: Parameters<typeof reducer>[1]) => void;

function useStream(
  deps: Deps,
  dispatch: Dispatch,
  stateRef: { current: PagerState },
  deviceToken: string | null,
): void {
  useEffect(
    () =>
      deps.client.connect({
        onMessage: (message) =>
          handleStream(message, { dispatch, settings: () => stateRef.current.settings }),
        onStatus: (connection) => dispatch({ type: 'connection', connection }),
      }),
    // Reconnecting on a new token is what makes pairing take effect at once:
    // the Central refuses an unauthenticated upgrade, so there is nothing to
    // connect to before the device exists.
    [deps, dispatch, stateRef, deviceToken],
  );
}

function useNetworkListeners(dispatch: Dispatch): void {
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const online = (): void => dispatch({ type: 'connection', connection: 'online' });
    const offline = (): void => dispatch({ type: 'connection', connection: 'offline' });
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    return () => {
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
    };
  }, [dispatch]);
}

/**
 * On boot: resynchronise the queue as soon as a device is registered. Pages are
 * displayable without the key; only a decision needs it, so a registered device
 * whose in-memory key was lost by a reload still shows its pages and is told
 * why it cannot decide.
 */
function useBoot(
  actions: PagerActions,
  dispatch: Dispatch,
  stateRef: { current: PagerState },
  keysRef: { current: DeviceKeys | null },
): void {
  useEffect(() => {
    const snapshot = stateRef.current;
    if (!snapshot.device) return;
    void actions.sync();
    if (keysRef.current) return;
    dispatch({
      type: 'notice',
      notice: translate(snapshot.settings.lang, 'pairing.keyLost'),
    });
  }, [actions, dispatch, stateRef, keysRef]);
}

/**
 * The Central's QR opens `/?pair=<id>&code=<code>`: the boot consumes it once,
 * through the very same `pair` action the Pairing screen uses, then clears the
 * single-use code from the address bar. A device hydrated from storage wins —
 * an already paired pager never re-pairs from a stale link. The ref is what
 * keeps StrictMode's double effect (and any re-run) to a single attempt.
 */
function useAutoPair(actions: PagerActions, stateRef: { current: PagerState }): void {
  const attempted = useRef(false);
  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;
    if (stateRef.current.device) return;
    const request = resolveAutoPair();
    if (!request) return;
    void actions.pair(request.code).finally(clearAutoPairFromLocation);
  }, [actions, stateRef]);
}

export type { StoragePort, CentralClient, CryptoPort, PushPort };

/**
 * BIP-F-19 — a notification action, when the pager is open, is decided here.
 * The service worker never signs: it asks the page, and the page signs.
 */
function useServiceWorkerActions(
  actions: PagerActions,
  stateRef: { current: PagerState },
): void {
  useEffect(
    () =>
      listenForServiceWorker((message) => {
        const verdict = verdictOf(message);
        if (!verdict) return;
        if (!targetPage(stateRef.current, message)) return;
        void actions.decide(verdict);
      }),
    [actions, stateRef],
  );
}

/**
 * BIP-F-19 / BIP-F-23 — the pager may be opened by a notification or by a
 * call back link. The query string names the page and, for a green page, the
 * action to apply once the page is on screen.
 */
function useOpenRequest(
  actions: PagerActions,
  dispatch: Dispatch,
  stateRef: { current: PagerState },
): void {
  useEffect(() => {
    const location = (globalThis as { location?: Location }).location;
    if (!location) return;
    const request = readOpenRequest(location.search);
    if (!request.pageId) return;
    dispatch({ type: 'screen', screen: 'pager' });
    // A decision needs the page on screen and the key in memory: the private
    // key never leaves the page, so a cold start can only show the page.
    if (!request.action) return;
    const page = targetPage(stateRef.current, { type: 'bipeur:action', action: request.action, page_id: request.pageId });
    if (page) void actions.decide(request.action);
  }, [actions, dispatch, stateRef]);
}


/** The value handed to the screen components: state, translator and actions. */
function buildApi(
  state: PagerState,
  deps: Deps,
  actions: PagerActions,
  dispatch: Dispatch,
  stateRef: { current: PagerState },
): PagerApi {
  return {
    state,
    t: (key, vars) => translate(state.settings.lang, key, vars),
    go: (screen) => dispatch({ type: 'screen', screen }),
    nextDetail: () => dispatch({ type: 'detail.next' }),
    updateSettings: (patch) => {
      writeJson(deps.storage, STORAGE_KEYS.settings, { ...stateRef.current.settings, ...patch });
      dispatch({ type: 'settings', patch });
    },
    decide: actions.decide,
    retry: actions.retry,
    pair: actions.pair,
    startDemo: actions.startDemo,
    revoke: actions.revoke,
    cryptoSupported: supportsDeviceKeys(deps.crypto),
    now: deps.now,
  };
}
