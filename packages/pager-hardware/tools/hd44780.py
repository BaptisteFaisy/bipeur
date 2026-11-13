#!/usr/bin/env python3
"""Drive an HD44780 glass through a PCF8574 I2C backpack.

The hardware pager shows its pages on a 20x4 or 16x2 HD44780, wired to the
Raspberry Pi over I2C with one of the ubiquitous PCF8574 backpacks. This
helper is the whole driver: `bip-pager-hw` shells out to

    python3 tools/hd44780.py <row1> <row2> [<row3> <row4>]

and this script writes each row to the glass. It needs only `smbus2`:

    sudo apt install -y python3-smbus i2c-tools
    pip3 install smbus2

The default I2C address is 0x27 (most backpacks); change ADDRESS below if the
backpack answers on 0x3F instead (`i2cdetect -y 1`).
"""
import sys
import time

try:
    from smbus2 import SMBus
except ImportError:  # pragma: no cover
    SMBus = None

ADDRESS = 0x27
BUS = 1

# Pin bits of the PCF8574 backpack: RS is P0, EN is P2, backlight is P3, and
# the data nibble DB4-DB7 sits in P4-P7.
RS = 0x01
EN = 0x04
BL = 0x08

# HD44780 commands (4-bit mode).
FUNCTION_4BIT = 0x28
DISPLAY_ON = 0x0C
ENTRY_MODE = 0x06
CLEAR = 0x01

# DDRAM start of each line: 20x4 and 16x2 are wired the same way.
LINE_ADDRESSES = (0x00, 0x40, 0x14, 0x54)


class Hd44780:
    """A minimal 4-bit HD44780 over the PCF8574 backpack."""

    def __init__(self, bus, address):
        self.bus = bus
        self.address = address

    def _pulse(self, byte):
        """Toggle EN so the LCD latches the nibble on the data pins."""
        self.bus.write_byte(self.address, byte | EN)
        time.sleep(0.0005)
        self.bus.write_byte(self.address, byte & ~EN)
        time.sleep(0.0001)

    def _write(self, data, mode):
        """Send one 8-bit value in 4-bit mode: high nibble, then low."""
        self._pulse(data & 0xF0 | mode | BL)
        self._pulse((data << 4) & 0xF0 | mode | BL)

    def command(self, cmd):
        self._write(cmd, 0)

    def write_char(self, char):
        self._write(ord(char), RS)

    def init(self):
        """Power-on sequence: 8-bit x3, then 4-bit, then the real setup."""
        time.sleep(0.05)
        for _ in range(3):
            self._pulse(0x30 | BL)
            time.sleep(0.005)
        self._pulse(0x20 | BL)
        time.sleep(0.005)
        self.command(FUNCTION_4BIT)
        self.command(DISPLAY_ON)
        self.command(CLEAR)
        time.sleep(0.005)
        self.command(ENTRY_MODE)


def write_line(lcd, line, address):
    """Move to `address` and write the characters of `line`."""
    lcd.command(0x80 | address)
    for char in line:
        lcd.write_char(char)


def main():
    if SMBus is None:
        sys.stderr.write("hd44780: smbus2 is not installed (pip3 install smbus2)\n")
        return 1
    rows = sys.argv[1:]
    lcd = Hd44780(SMBus(BUS), ADDRESS)
    lcd.init()
    for index, address in enumerate(LINE_ADDRESSES):
        if index < len(rows):
            write_line(lcd, rows[index], address)
    return 0


if __name__ == "__main__":
    sys.exit(main())