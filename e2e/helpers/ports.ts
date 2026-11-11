/**
 * Every port of the E2E suite derives from ONE base read in the environment
 * (`BIPEUR_E2E_PORT_BASE`), plus a fixed offset per role — the offsets live
 * here and nowhere else. The two CI jobs play the two groups in parallel on
 * the same machine: giving each job its own base (9200 and 9300 in
 * `.github/workflows/e2e.yml`) is what keeps their Centrals apart.
 *
 * The default base stays clear of the other loopback services of the host:
 * 8787 (another project) and 8790-8810 (development Centrals) — hence 9200.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PORT_BASE = 9200;

/** Fixed offset per role: the shared Central first, then one per scenario. */
const OFFSETS = {
  sharedCentral: 0,
  p1Pair: 11,
  p1SingleUse: 12,
  p1PairingScreen: 13,
  p2Approve: 14,
  p3HoldToRefuse: 15,
  p4Choice: 16,
  p5Expiry: 21,
  p6Budget: 31,
  p6RedGoesThrough: 32,
} as const;

export type PortRole = keyof typeof OFFSETS;

/** The base every port of this run derives from. */
export function portBase(): number {
  return Number.parseInt(process.env.BIPEUR_E2E_PORT_BASE ?? String(DEFAULT_PORT_BASE), 10);
}

/** The port of one role: base + its fixed offset. */
export function portFor(role: PortRole): number {
  return portBase() + OFFSETS[role];
}

/** Runtime directories are keyed by the base: two parallel runs share no file. */
function dirFor(name: string): string {
  return resolve(HERE, '..', name, `base-${portBase()}`);
}

/** The directory of the shared Central's SQLite file and descriptor. */
export function runtimeDir(): string {
  return process.env.BIPEUR_E2E_DB_DIR ?? dirFor('.runtime');
}

/** The HTML report folder of this run. */
export function reportDir(): string {
  return dirFor('playwright-report');
}

/** Traces and failure attachments of this run. */
export function outputDir(): string {
  return dirFor('test-results');
}
