/**
 * The cost of human attention (BIP-F-44).
 *
 * "Six pages an hour" is a limit, not a measurement. Nobody knows what the
 * attention actually costs, so nobody can tell a useful gate from a noisy one.
 * This module turns the facts of the journal — created, delivered, read,
 * decided, and how long each took — into a number a person can act on.
 *
 * Everything here is derived from samples that already exist. Nothing is
 * counted twice, nothing is invented: a page that was never read contributes
 * no reading time, and a page that was never decided contributes no decision
 * time. A station that was muted still paid the interruption.
 */
import { HOUR, MINUTE, median } from './time.js';
import type { Verdict } from './types.js';

/** One page, as the journal knows it. Null means "this never happened". */
export interface AttentionSample {
  /** The station that asked, so the bill can be broken down per station. */
  source_id: string;
  created_at: number;
  delivered_at: number | null;
  read_at: number | null;
  decided_at: number | null;
  /** The signed decision's own latency, when there is one. */
  latency_ms: number | null;
  verdict: Verdict | null;
}

export interface AttentionCost {
  pages: number;
  /** Reached a pager at all. */
  delivered: number;
  /** Opened and looked at. */
  read: number;
  decided: number;
  approved: number;
  denied: number;
  /** Denied over decided: 0 when nothing was decided. */
  denial_rate: number;
  /** Sum of the wait before a human laid eyes on it. */
  read_ms: number;
  /** Sum of the time a human spent deciding. */
  decide_ms: number;
  /** read_ms + decide_ms: the attention bill. */
  human_ms: number;
  /** Human minutes, rounded to a tenth — the number a manager reads. */
  human_minutes: number;
  /** Pages per hour over the span the samples cover. */
  interruptions_per_hour: number;
  /** Median decision time: the shape of the habit, not the total. */
  decision_median_ms: number | null;
}

/** How long between the first and the last sample, in ms (0 when there is one). */
function spanOf(samples: readonly AttentionSample[]): number {
  if (samples.length < 2) return 0;
  const times = samples.map((sample) => sample.created_at);
  return Math.max(...times) - Math.min(...times);
}

/**
 * The bill for one station, one project, one pager — whatever shares a set of
 * pages. The span is measured over the samples themselves, so a quiet week
 * does not dilute a busy hour into nothing.
 */
export function attentionCost(samples: readonly AttentionSample[]): AttentionCost {
  const decided = samples.filter((s) => s.decided_at !== null);
  const latencies = decided.map((s) => s.latency_ms ?? 0);
  const readMs = samples.reduce((sum, s) => sum + readWait(s), 0);
  const decideMs = latencies.reduce((sum, ms) => sum + ms, 0);
  const denied = decided.filter((s) => s.verdict === 'deny').length;
  const humanMs = readMs + decideMs;
  const span = spanOf(samples);
  const hours = span > 0 ? span / HOUR : 0;

  return {
    pages: samples.length,
    delivered: samples.filter((s) => s.delivered_at !== null).length,
    read: samples.filter((s) => s.read_at !== null).length,
    decided: decided.length,
    approved: decided.filter((s) => s.verdict === 'approve').length,
    denied,
    denial_rate: decided.length === 0 ? 0 : denied / decided.length,
    read_ms: readMs,
    decide_ms: decideMs,
    human_ms: humanMs,
    human_minutes: Math.round((humanMs / MINUTE) * 10) / 10,
    interruptions_per_hour: hours > 0 ? Math.round((samples.length / hours) * 10) / 10 : samples.length,
    decision_median_ms: median(latencies),
  };
}

/** The wait before a human looked: delivered → read, or created → read. */
function readWait(sample: AttentionSample): number {
  if (sample.read_at === null) return 0;
  const from = sample.delivered_at ?? sample.created_at;
  return Math.max(0, sample.read_at - from);
}

/** One hour of a series: the bucket a dashboard draws. */
export interface AttentionBucket {
  /** Start of the hour, epoch ms. */
  at: number;
  pages: number;
  human_ms: number;
}

/**
 * The last `hours` hours, bucketed. Buckets with no page are kept as zeros: a
 * gap is a fact, and a dashboard that hides it reads as a busy product.
 */
export function attentionSeries(
  samples: readonly AttentionSample[],
  now: number,
  hours = 24,
): AttentionBucket[] {
  const from = now - hours * HOUR;
  const buckets: AttentionBucket[] = Array.from({ length: hours }, (_, i) => ({
    at: from + i * HOUR,
    pages: 0,
    human_ms: 0,
  }));
  for (const sample of samples) {
    if (sample.created_at < from || sample.created_at >= now) continue;
    const index = Math.min(hours - 1, Math.floor((sample.created_at - from) / HOUR));
    const bucket = buckets[index]!;
    bucket.pages += 1;
    bucket.human_ms += readWait(sample) + (sample.decided_at !== null ? (sample.latency_ms ?? 0) : 0);
  }
  return buckets;
}
