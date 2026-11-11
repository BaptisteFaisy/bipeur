/** Output of `bip`: one line of pager, then the decision; or machine JSON. */
import type { AskResult } from './ask.js';

export interface MachineResult {
  status: string;
  choice: string | null;
  page_id: string;
  latency_ms: number;
}

/** The exact `--json` shape promised to scripts: four keys, nothing else. */
export function toMachineResult(result: AskResult): MachineResult {
  return {
    status: result.status,
    choice: result.choice,
    page_id: result.page_id,
    latency_ms: result.latency_ms,
  };
}

export function toJson(result: AskResult): string {
  return JSON.stringify(toMachineResult(result));
}

function seconds(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function describeDecision(result: AskResult): string {
  const choice = result.choice === null ? '' : ` ${result.choice}`;
  return `-> ${result.status}${choice} in ${seconds(result.latency_ms)}`;
}

export function toHuman(result: AskResult): string[] {
  return [result.line, describeDecision(result)];
}
