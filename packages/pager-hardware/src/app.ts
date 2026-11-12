/**
 * The wiring of the binary: the Central client, the display, the buttons and
 * the buzzer, all assembled around the pure session. Everything is injectable
 * so a test can drive the app with a fake Central and a mock display.
 */
import type { HardwareOptions } from './args.js';
import { GpioButtons, MockButtons, type ButtonReader } from './buttons.js';
import { GpioBuzzer, MockBuzzer, type Buzzer } from './buzzer.js';
import { createCentralApi } from './central.js';
import type { DeviceKey } from './device.js';
import {
  CharLcdDisplay,
  LCD_COLS_20,
  LCD_ROWS_20,
  MockDisplay,
  ShellLcdWriter,
  type DisplayDriver,
} from './display.js';
import { PagerSession } from './session.js';

export interface AppDeps {
  options: HardwareOptions;
  key?: DeviceKey;
  now?: () => number;
  display?: DisplayDriver;
  buttons?: ButtonReader;
  buzzer?: Buzzer;
}

export interface App {
  session: PagerSession;
  stop(): void;
}

const BUZZER_PIN = 18; // BCM 18: the piezo through the transistor.

/** Assemble the machine and pair it. Throws on an error the screen cannot show. */
export async function startApp(deps: AppDeps): Promise<App> {
  const options = deps.options;
  const api = createCentralApi({ baseUrl: options.central });
  const display = deps.display ?? buildDisplay(options);
  const buzzer = deps.buzzer ?? buildBuzzer(options);
  const buttons = deps.buttons ?? buildButtons(options);
  const session = new PagerSession({
    api,
    display,
    buzzer,
    code: options.code,
    key: deps.key,
    now: deps.now,
    cols: LCD_COLS_20,
    rows: LCD_ROWS_20,
  });
  await session.start();
  buttons.start(session);
  const timer = setInterval(() => void session.poll(), options.pollMs);
  void session.poll();
  return {
    session,
    stop() {
      clearInterval(timer);
      buttons.stop();
    },
  };
}

function buildDisplay(options: HardwareOptions): DisplayDriver {
  if (options.display === 'hd44780') {
    return new CharLcdDisplay(new ShellLcdWriter(), { cols: LCD_COLS_20, rows: LCD_ROWS_20 });
  }
  return new MockDisplay();
}

function buildButtons(options: HardwareOptions): ButtonReader {
  return options.buttons === 'gpio' ? new GpioButtons() : new MockButtons();
}

function buildBuzzer(options: HardwareOptions): Buzzer {
  return options.buzzer === 'gpio' ? new GpioBuzzer(BUZZER_PIN) : new MockBuzzer();
}