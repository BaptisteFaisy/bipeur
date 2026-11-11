/**
 * @bipeur/crew-app — the Kiro Crew app (BIP-F-27): relay approval events to
 * the pager, resolve them from the human's signed decision.
 */
export { createCrewAuth, CrewAuthError, readAppSecret, type CrewAuth, type CrewAuthDeps } from './auth.js';
export { createBeeperClient, BeeperError, type BeeperClient, type PageSummary } from './beeper.js';
export {
  DEFAULTS,
  cookieNameOf,
  endpointOf,
  fillTemplate,
  httpBaseOf,
  loadConfig,
  wsBaseOf,
  wsEndpointOf,
  type CrewConfig,
} from './config.js';
export {
  approvalDedupeKey,
  crewFrameSchema,
  normalizeFrame,
  parseFrame,
  type ApprovalData,
  type ApprovalFrame,
  type CrewFrame,
} from './events.js';
export {
  createWebSocketGateway,
  type CrewGateway,
  type GatewayState,
  type SocketOptions,
  type WebSocketFactory,
  type WebSocketLike,
} from './gateway.js';
export { BoundedQueue } from './queue.js';
export { relay, EVENT_ATTEMPTS, type Relay, type RelayDeps } from './relay.js';
export {
  resolveApproval,
  responseIdOf,
  toResolution,
  type Resolution,
  type ResolveOutcome,
} from './resolve.js';
export { waitForDecision, type DecisionWait } from './wait.js';
