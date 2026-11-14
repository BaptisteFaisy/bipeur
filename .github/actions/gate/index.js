#!/usr/bin/env node
/**
 * Entry point of the `gate` action (BIP-F-48).
 *
 * Three lines of glue, deliberately. The logic lives in `packages/gate-action`,
 * where vitest reaches it through the workspace config; a JavaScript action needs
 * no bundle, no install and no build step, so the runner executes this file
 * straight from the checkout — which is also why nothing here may require
 * `node_modules`: the action's own directory has none.
 */
import { runGate } from '../../../packages/gate-action/src/lib/run.js';

const verdict = await runGate();
if (verdict.outcome !== 'pass') process.exitCode = 1;
