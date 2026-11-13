/**
 * The buzzer of the hardware pager. `MockBuzzer` prints so a test can count
 * the beeps; `GpioBuzzer` drives a piezo through a transistor on a GPIO pin
 * via the Linux sysfs, a square wave with no native npm module.
 */
import { writeFileSync } from 'node:fs';

/** Beeps on a new page. Injected, so the machine never owns the hardware. */
export interface Buzzer {
  beep(times?: number): void;
}

/** A buzzer that prints its beeps — the mock of the desk. */
export class MockBuzzer implements Buzzer {
  constructor(private readonly write: (text: string) => void = (text) => process.stdout.write(text)) {}

  beep(times = 1): void {
    this.write(`BEEP x${times}\n`);
  }
}

/** Drive a GPIO pin high (buzzer on) or low (off); a no-op off the Pi. */
function setGpio(pin: number, high: boolean): void {
  try {
    writeFileSync(`/sys/class/gpio/gpio${pin}/value`, high ? '1' : '0');
  } catch {
    // Not on the Pi, or the pin is not exported: no sound, never a crash.
  }
}

/**
 * The real buzzer: a square wave on one pin — the transistor's base — for
 * `times` pulses of 80 ms. The pin must be exported at boot (see the README).
 */
export class GpioBuzzer implements Buzzer {
  constructor(
    private readonly pin: number,
    private readonly setPin: (pin: number, high: boolean) => void = setGpio,
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}

  beep(times = 1): void {
    void this.ring(times);
  }

  private async ring(times: number): Promise<void> {
    for (let i = 0; i < times; i += 1) {
      this.setPin(this.pin, true);
      await this.sleep(80);
      this.setPin(this.pin, false);
      await this.sleep(80);
    }
  }
}