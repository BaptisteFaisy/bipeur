/**
 * @bipeur/crew-app — the Kiro Crew app (BIP-F-27): relay approval events to the
 * pager, resolve them from the human's signed decision.
 */
export { createBeeperClient, BeeperError, type BeeperClient, type PageSummary } from './beeper.js';
export {
  DEFAULTS,
  endpointOf,
  httpBaseOf,
  loadConfig,
  type CrewConfig,
} from './config.js';
export {
  approvalDedupeKey,
  crewEventSchema,
  normalizeRaw,
  parseEvent,
  type ApprovalEvent,
  type CrewEvent,
} from './events.js';
export {
  createWebSocketGateway,
  type CrewGateway,
  type GatewayState,
  type WebSocketFactory,
  type WebSocketLike,
} from './gateway.js';
export { BoundedQueue } from './queue.js';
export { relay, EVENT_ATTEMPTS, type Relay, type RelayDeps } from './relay.js';
export { resolveApproval, toResolution, type Resolution, type ResolveOutcome } from './resolve.js';
export { waitForDecision, type DecisionWait } from './wait.js';
