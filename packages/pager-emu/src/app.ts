/**
 * The wiring of the emulator: the gateway, the screen and the Central.
 *
 * Everything the binary needs is injected here, so the whole application can
 * be driven by a test — a fake transport, a fake Central, no terminal.
 */
import { createCentralApi, type CentralApi, type Pairing } from './central.js';
import { buildDecision } from './decision.js';
import { generateDeviceKey, type DeviceKey } from './device-key.js';
import { renderScreen } from './screen.js';
import { PagerSession, type Answer, type PagerView } from './session.js';
import { nodeTransport, type Transport } from './transport.js';
import type { EmulatorOptions } from './args.js';

export interface AppDeps {
  options: EmulatorOptions;
  /** Injected in the tests; the binary uses the real socket. */
  transport?: Transport;
  /** Injected in the tests; the binary uses the real HTTP client. */
  centralApi?: CentralApi;
  /** Injected in the tests; the binary uses the WebCrypto of the process. */
  key?: DeviceKey;
  now?: () => number;
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
  /** Clears the screen before every frame (a terminal), or not (a log). */
  clearScreen?: string;
  /** Called when the session is over: the gateway hung up, or the human did. */
  onExit?: () => void;
}

export interface App {
  session: PagerSession;
  /** The key of the device: the decisions are signed with it. */
  key: DeviceKey;
  pairing: Pairing | null;
  /** What the Central answered, for the screen. */
  centralStatus: string | null;
  /** Close the connection and hang up. */
  shutdown(): void;
}

/** The name the emulator gives to itself when it pairs. */
export const DEVICE_NAME = 'bip-pager';

/**
 * Start the emulator: pair with the Central when a code was given, connect to
 * the gateway, and draw the screen on every change.
 */
export async function startApp(deps: AppDeps): Promise<App> {
  const options = deps.options;
  const now = deps.now ?? (() => Date.now());
  const stdout = deps.stdout ?? ((text: string) => void process.stdout.write(text));
  const stderr = deps.stderr ?? ((text: string) => void process.stderr.write(text));
  const clear = deps.clearScreen ?? '';
  const key = deps.key ?? (await generateDeviceKey());
  const api = deps.centralApi ?? createCentralApi({ baseUrl: options.central });

  let pairing: Pairing | null = null;
  if (options.code !== null) {
    pairing = await api.pair(options.code, key.publicKeyJwk, DEVICE_NAME);
  }

  const transport = deps.transport ?? nodeTransport(options.host, options.port);
  const app: App = {
    session: null as unknown as PagerSession,
    key,
    pairing,
    centralStatus:
      pairing === null
        ? 'not paired — answers reach the gateway only'
        : `paired as ${pairing.deviceId}`,
    shutdown: () => transport.close(),
  };

  const draw = (view: PagerView): void => {
    stdout(`${clear}${renderScreen(view, { central: app.centralStatus })}\n`);
    if (view.state === 'closed') deps.onExit?.();
  };

  const session = new PagerSession({
    transport,
    capcode: options.capcode,
    onChange: draw,
    onLog: (line) => stderr(`${line}\n`),
    onAnswer: (answer) => {
      void postDecision(answer, app, api, now).then((status) => {
        app.centralStatus = status;
        draw(session.view);
      });
    },
  });
  app.session = session;
  await session.start();
  draw(session.view);
  return app;
}

/**
 * Tell the Central what the human decided: the claims are the ones of the
 * PWA, signed with the key of the device. Nothing is claimed as sent unless
 * the Central answered.
 */
async function postDecision(
  answer: Answer,
  app: App,
  api: CentralApi,
  now: () => number,
): Promise<string> {
  if (app.pairing === null) return 'not paired — answers reach the gateway only';
  const view = app.session.view;
  if (view.pageId === null) return 'no page id from the gateway — nothing was signed';
  const fingerprint =
    view.fingerprint ??
    (await api.fingerprintOf(view.pageId, app.pairing.deviceId, app.pairing.token));
  if (fingerprint === null) return 'no fingerprint for that page — nothing was signed';
  const hasOptions = view.choices.length > 0;
  try {
    const decision = await buildDecision(
      {
        pageId: view.pageId,
        fingerprint,
        verdict: hasOptions ? 'choice' : answer.letter === 'A' ? 'approve' : 'deny',
        choice: hasOptions ? answer.letter : null,
        deviceId: app.pairing.deviceId,
        hasOptions,
        now: now(),
      },
      app.key,
    );
    const ack = await api.postDecision(view.pageId, decision, app.pairing.token);
    return ack.accepted ? 'decision signed and accepted' : `decision refused: ${ack.reason ?? 'unknown'}`;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return `decision not sent: ${reason}`;
  }
}
