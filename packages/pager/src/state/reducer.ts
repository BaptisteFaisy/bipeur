/**
 * Pure reducer of the pager. No I/O, no clock: everything that depends on time
 * or the network is decided by the caller and passed in as an action.
 */
import { DETAIL_SCREENS_MAX, type PageRecord } from '@bipeur/core';
import {
  MEMORY_LIMIT,
  type Connection,
  type DeviceInfo,
  type MemoryEntry,
  type PagerState,
  type QueuedDecision,
  type Screen,
  type Settings,
} from './types.js';

export const DEFAULT_SETTINGS: Settings = {
  sound: false,
  vibration: false,
  speech: false,
  quietHours: { enabled: false, from: '22:00', to: '07:00' },
  budgetPerHour: 6,
  hideDetailWhenLocked: false,
  lang: 'en',
};

export function initialState(): PagerState {
  return {
    screen: 'pager',
    connection: 'connecting',
    queue: [],
    detailIndex: 0,
    memory: [],
    outbox: [],
    settings: DEFAULT_SETTINGS,
    device: null,
    notice: null,
    error: null,
  };
}

export type Action =
  | { type: 'screen'; screen: Screen }
  | { type: 'connection'; connection: Connection }
  | { type: 'pages.sync'; pages: PageRecord[] }
  | { type: 'page.delivered'; page: PageRecord }
  | { type: 'page.closed'; pageId: string }
  | { type: 'detail.next' }
  | { type: 'detail.reset' }
  | { type: 'decision.sent'; entry: MemoryEntry }
  | { type: 'decision.queued'; entry: QueuedDecision }
  | { type: 'outbox.cleared'; pageId: string }
  | { type: 'settings'; patch: Partial<Settings> }
  | { type: 'device.paired'; device: DeviceInfo }
  | { type: 'device.revoked' }
  | { type: 'memory.hydrate'; memory: MemoryEntry[] }
  | { type: 'notice'; notice: string | null }
  | { type: 'error'; error: string | null };

/** The page on the LCD is always the head of the queue. */
export function currentPage(state: PagerState): PageRecord | null {
  return state.queue[0] ?? null;
}

/** 1 (the line) + the detail screens the page actually carries, three at most. */
export function detailCount(page: PageRecord | null): number {
  if (!page) return 1;
  return Math.min(page.detail.length, DETAIL_SCREENS_MAX) + 1;
}

export function isQueued(state: PagerState, pageId: string): boolean {
  return state.outbox.some((decision) => decision.pageId === pageId);
}

function withoutPage(queue: PageRecord[], pageId: string): PageRecord[] {
  return queue.filter((page) => page.id !== pageId);
}

function pushMemory(memory: MemoryEntry[], entry: MemoryEntry): MemoryEntry[] {
  return [entry, ...memory].slice(0, MEMORY_LIMIT);
}

export function reducer(state: PagerState, action: Action): PagerState {
  return isQueueAction(action) ? reduceQueue(state, action) : reduceRest(state, action);
}

/** The actions that move the pages around: the queue and the detail index. */
type QueueAction = Extract<
  Action,
  { type: 'page.delivered' | 'page.closed' | 'detail.next' | 'detail.reset' | 'pages.sync' }
>;

type RestAction = Exclude<Action, QueueAction>;

function isQueueAction(action: Action): action is QueueAction {
  return QUEUE_ACTION_TYPES.has(action.type);
}

const QUEUE_ACTION_TYPES: ReadonlySet<Action['type']> = new Set([
  'page.delivered',
  'page.closed',
  'detail.next',
  'detail.reset',
  'pages.sync',
]);

function reduceQueue(state: PagerState, action: QueueAction): PagerState {
  switch (action.type) {
    case 'pages.sync':
      return { ...state, queue: action.pages, detailIndex: 0 };
    case 'page.delivered':
      return { ...state, ...deliverPage(state, action.page) };
    case 'page.closed':
      return {
        ...state,
        queue: withoutPage(state.queue, action.pageId),
        outbox: state.outbox.filter((decision) => decision.pageId !== action.pageId),
        detailIndex: 0,
      };
    case 'detail.next':
      return { ...state, detailIndex: (state.detailIndex + 1) % detailCount(currentPage(state)) };
    case 'detail.reset':
      return { ...state, detailIndex: 0 };
  }
}

/** The actions that touch the decisions, the memory, the settings and the device. */
function reduceRest(state: PagerState, action: RestAction): PagerState {
  switch (action.type) {
    case 'screen':
      return { ...state, screen: action.screen, error: null };
    case 'connection':
      return { ...state, connection: action.connection };
    case 'decision.sent':
      return {
        ...state,
        queue: withoutPage(state.queue, action.entry.pageId),
        outbox: state.outbox.filter((decision) => decision.pageId !== action.entry.pageId),
        memory: pushMemory(state.memory, action.entry),
        detailIndex: 0,
        error: null,
      };
    case 'decision.queued':
      return {
        ...state,
        outbox: [...state.outbox.filter((d) => d.pageId !== action.entry.pageId), action.entry],
      };
    case 'outbox.cleared':
      return {
        ...state,
        outbox: state.outbox.filter((decision) => decision.pageId !== action.pageId),
      };
    case 'settings':
      return { ...state, settings: { ...state.settings, ...action.patch } };
    case 'device.paired':
      return { ...state, device: action.device, error: null, notice: null };
    case 'device.revoked':
      return { ...state, device: null, outbox: [], queue: [] };
    case 'memory.hydrate':
      return { ...state, memory: action.memory.slice(0, MEMORY_LIMIT) };
    case 'notice':
      return { ...state, notice: action.notice };
    case 'error':
      return { ...state, error: action.error };
  }
}

/** A page already in the queue is refreshed, not duplicated. */
function deliverPage(state: PagerState, page: PageRecord): Pick<PagerState, 'queue' | 'detailIndex'> {
  const exists = state.queue.some((item) => item.id === page.id);
  const queue = exists
    ? state.queue.map((item) => (item.id === page.id ? page : item))
    : [...state.queue, page];
  return { queue, detailIndex: state.queue.length === 0 ? 0 : state.detailIndex };
}

