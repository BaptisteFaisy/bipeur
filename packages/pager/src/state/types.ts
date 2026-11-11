/** State shape of the pager: one queue, one memory, one outbox, one device. */
import type { DecisionClaims, PageRecord, Risk, Verdict } from '@bipeur/core';
import type { Lang } from '../i18n/index.js';

export type Screen = 'pager' | 'memory' | 'settings' | 'pairing' | 'demo';
export type Connection = 'connecting' | 'online' | 'offline';

export interface QuietHours {
  enabled: boolean;
  /** `HH:MM`, local time. */
  from: string;
  to: string;
}

/** BIP-F-21. Every switch starts in its safe position. */
export interface Settings {
  sound: boolean;
  vibration: boolean;
  quietHours: QuietHours;
  budgetPerHour: number;
  hideDetailWhenLocked: boolean;
  lang: Lang;
}

/** One line of the memory of BIP-F-20: what was decided, and how fast. */
export interface MemoryEntry {
  pageId: string;
  line: string;
  risk: Risk;
  code: number;
  station: string;
  verdict: Verdict;
  choice: string | null;
  decidedAt: number;
  latencyMs: number;
}

/** A signed decision that has not been acknowledged yet (BIP-F-22). */
export interface QueuedDecision {
  pageId: string;
  claims: DecisionClaims;
  signature: string;
  queuedAt: number;
}

export interface DeviceInfo {
  id: string;
  name: string;
  pairedAt: number;
}

export interface PagerState {
  screen: Screen;
  connection: Connection;
  /** Pending pages, oldest first: `queue[0]` is the one on the LCD. */
  queue: PageRecord[];
  /** 0 = the page line, 1..3 = detail screens 2..4. */
  detailIndex: number;
  memory: MemoryEntry[];
  outbox: QueuedDecision[];
  settings: Settings;
  device: DeviceInfo | null;
  notice: string | null;
  error: string | null;
}

/** BIP-F-20: the memory keeps the last fifty pages, no more. */
export const MEMORY_LIMIT = 50;

/** BIP-F-17: a red page needs one second of press-and-hold. */
export const HOLD_MS = 1000;
