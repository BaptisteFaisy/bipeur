#!/usr/bin/env node
/**
 * Entry point of the `gate-pr` action (BIP-F-48).
 *
 * Same glue as `gate`, different preparation: the page carries the head SHA of
 * the pull request as a fact, so the signature covers the commit under review.
 */
import { runGatePr } from '../../../packages/gate-action/src/lib/run.js';

const verdict = await runGatePr();
if (verdict.outcome !== 'pass') process.exitCode = 1;
