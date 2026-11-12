/**
 * @bipeur/pager-emu — `bip-pager`, a pager of 1995 in a terminal.
 *
 * The emulator speaks the SNPP unit channel to the gateway (RFC 1861 level 3),
 * shows the page on a 4x20 LCD, and signs its decisions for the Central, like
 * the PWA does.
 */
export { parseArgs, DEFAULTS, type EmulatorOptions } from './args.js';
export { startApp, DEVICE_NAME, type App, type AppDeps } from './app.js';
export { createCentralApi, CentralError, type CentralApi, type CentralOptions, type DecisionAck, type Pairing } from './central.js';
export { buildDecision, DecisionRefused, type DecisionRequest } from './decision.js';
export { generateDeviceKey, signBytes, DeviceKeyUnavailable, type DeviceKey } from './device-key.js';
export { parseFrame, MCR_CODE_PATTERN, type GatewayFrame } from './frames.js';
export { HELP_TEXT, DEMO_TRANSCRIPT } from './help.js';
export { keyAction, letterOfCode, CHOICE_LETTERS, MCR_CODES, type KeyAction } from './keys.js';
export { lcdRows, renderLcd, pageCodeOf, LCD_COLS, LCD_ROWS, type LcdRow } from './lcd.js';
export { renderScreen, SCREEN_WIDTH, type ScreenOptions } from './screen.js';
export { ANSWER_SENT, PagerSession, type Answer, type Choice, type PagerView, type SessionOptions, type SessionState } from './session.js';
export { nodeTransport, splitLines, type Transport } from './transport.js';

export const PACKAGE_NAME = '@bipeur/pager-emu';
