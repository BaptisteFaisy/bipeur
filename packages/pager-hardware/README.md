# bip-pager-hw — the physical pager

The software of a real hardware pager for Beeper: a Raspberry Pi Zero 2 W, an
HD44780 glass, three tactile buttons and a piezo buzzer. The machine pairs
itself as a device of the Central (an ECDSA P-256 key from `@bipeur/core`),
reads its pending pages, shows them on the glass, and when you press a button
signs the decision with the same claims as the PWA.

Everything I/O lives behind injected ports, so the whole machine runs on a
laptop with mocks — no Pi, no LCD, no network required to develop or test it.

## BOM

| Qty | Part | Notes |
|----:|------|-------|
| 1 | Raspberry Pi Zero 2 W | board + microSD (≥ 4 GB) + micro-USB power |
| 1 | HD44780 **20×4** (or 16×2) with I2C backpack (PCF8574) | address `0x27` (check `i2cdetect -y 1`; some are `0x3F`) |
| 3 | Tactile push-buttons (montee PCB) | A, B and one more for C/D; active-low, pull to GND |
| 3 | 10 kΩ resistors | pull-up on each button GPIO |
| 1 | Piezo buzzer (passif ou actif) | driven through the transistor |
| 1 | NPN transistor **2N2222 / BC547** | the switch for the buzzer |
| 1 | 1 kΩ resistor | base resistor of the transistor |
| 1 | 1 kΩ resistor | in series with an active piezo (volume/current limit) |
| — | Jumpers DuPont (mâle-femelle) | LCD + buttons + buzzer |
| 1 | Alimentation 5 V / 2 A, micro-USB | powers the Pi and the backlight |

Everything is through-hole or DuPont: no soldering strictly required, only a
breadboard or a prototype hat.

## Wiring (BCM numbering)

| Function | GPIO (BCM) | Physical pin |
|----------|-----------|--------------|
| LCD SDA (`SDA1`) | GPIO 2 | pin 3 |
| LCD SCL (`SCL1`) | GPIO 3 | pin 5 |
| LCD VCC / GND | 5 V / GND | pins 2 / 6 |
| Button A | GPIO 17 | pin 11 |
| Button B | GPIO 27 | pin 13 |
| Button C | GPIO 22 | pin 15 |
| Button D (optional) | GPIO 23 | pin 16 |
| Buzzer (transistor base) | GPIO 18 | pin 12 |

Each button is wired between its GPIO and GND, with a 10 kΩ pull-up from the
GPIO to 3V3: the pin reads HIGH at rest and LOW when pressed (active-low).
The buzzer: GPIO 18 → 1 kΩ → transistor base; collector → buzzer → 5 V;
emitter → GND (an active piezo goes between collector and 5 V with a 1 kΩ in
series, and needs its own 5 V, not a GPIO rail).

## Raspbian setup

```bash
sudo raspi-config            # enable I2C (Interface Options > I2C)
sudo apt install -y python3-smbus i2c-tools git
pip3 install smbus2
i2cdetect -y 1               # confirm the LCD shows at 0x27 (or 0x3F)
```

## Start

First on the laptop, with mocks — no hardware, verify the pairing and the page:

```bash
cd packages/pager-hardware
pnpm build
pnpm exec bip-pager-hw --code ABC123 --central http://127.0.0.1:8787 --display mock
# letters on stdin: a = approve/choice A, b = deny/choice B, c, d
```

Then on the Pi, with the real glass, buttons and buzzer:

```bash
sudo env PATH="$PATH" bip-pager-hw --code ABC123 --central https://central.example.net \
  --display hd44780 --buttons gpio --buzzer gpio
```

The six-character `--code` is the pairing code the Central shows. The first
run pairs (`POST /v1/devices`) and stores nothing — the key is non-extractable
and re-generated at each boot, so re-pair with a new code after a reboot.

## Shape of the package

- `src/session.ts` — the pure state machine: pairing → page → signed decision.
- `src/display.ts` — `DisplayDriver`, `MockDisplay`, `CharLcdDisplay` and the
  20×4 / 16×2 layout.
- `src/buttons.ts` — `ButtonInput`/`ButtonReader`, `MockButtons`, `GpioButtons`.
- `src/buzzer.ts` — `Buzzer`, `MockBuzzer`, `GpioBuzzer`.
- `src/central.ts` — the HTTP client of the Central (fetch injected).
- `tools/hd44780.py` — the `smbus2` driver shelled out by `CharLcdDisplay`.

The only dependency is `@bipeur/core: workspace:*`, like `packages/opencode-gate`.