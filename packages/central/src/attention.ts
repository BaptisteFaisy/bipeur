/**
 * The attention bill (BIP-F-44).
 *
 * "Six pages an hour" is a limit, not a measurement. This service turns the
 * journal into the number that is missing: what a human actually spent, per
 * station and over the last day. Everything is derived from the pages and the
 * decisions that already exist — no parallel counter, nothing invented.
 */
import {
  attentionCost,
  attentionSeries,
  HOUR,
  type AttentionCost,
  type AttentionSample,
  type AttentionBucket,
} from '@bipeur/core';
import type { Store } from './store/types.js';

/** One hour of the bill, with the station it belongs to. */
export interface StationBill {
  source_id: string;
  alias: string;
  cost: AttentionCost;
}

export interface AttentionReport {
  /** The whole journal, every station. */
  total: AttentionCost;
  /** Per station, worst bill first: the station to look at first. */
  stations: StationBill[];
  /** The last 24 hours, bucketed by hour, gaps kept as zeros. */
  series: AttentionBucket[];
  /** Hours the report covers. */
  window_hours: number;
}

/**
 * The bill for a window. `since` is inclusive; the series always covers
 * `windowHours` hours so a dashboard can draw one fixed axis.
 */
export function attentionReport(store: Store, now: number, windowHours = 24): AttentionReport {
  const since = now - windowHours * HOUR;
  const all = store.attentionSamples(null, since);
  const stations = store.stationsWithPages().map((station) => ({
    source_id: station.id,
    alias: station.alias,
    cost: attentionCost(samplesOf(all, station.id)),
  }));
  return {
    total: attentionCost(all),
    stations: stations.sort((a, b) => b.cost.human_ms - a.cost.human_ms),
    series: attentionSeries(all, now, windowHours),
    window_hours: windowHours,
  };
}

/** The samples of one station: the join carries the source id, one pass. */
function samplesOf(samples: readonly AttentionSample[], sourceId: string): AttentionSample[] {
  return samples.filter((sample) => sample.source_id === sourceId);
}
