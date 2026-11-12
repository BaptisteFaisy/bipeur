import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { GpioButtons, letterOfKey, MockButtons } from '../src/buttons.js';

describe('letterOfKey', () => {
  it('maps a key to its letter', () => {
    expect(letterOfKey('a')).toBe('A');
    expect(letterOfKey('B')).toBe('B');
    expect(letterOfKey('2')).toBe('B');
    expect(letterOfKey('')).toBeNull();
    expect(letterOfKey('zzz')).toBeNull();
  });
});

describe('MockButtons', () => {
  it('reads one letter per line', () => {
    const stream = new PassThrough();
    const seen: string[] = [];
    const buttons = new MockButtons(stream);
    buttons.start({ onPress: (letter) => seen.push(letter) });
    stream.write('a\nb\n1\n');
    expect(seen).toEqual(['A', 'B', 'A']);
  });

  it('reassembles a press split across chunks', () => {
    const stream = new PassThrough();
    const seen: string[] = [];
    const buttons = new MockButtons(stream);
    buttons.start({ onPress: (letter) => seen.push(letter) });
    stream.write('a');
    stream.write('\nb\n');
    expect(seen).toEqual(['A', 'B']);
  });
});

describe('GpioButtons', () => {
  it('reports the falling edge of a single pin', () => {
    vi.useFakeTimers();
    const states: Record<string, boolean> = { '17': false, '27': false, '22': false, '23': false };
    const read = (pin: number): boolean => states[String(pin)] ?? false;
    const buttons = new GpioButtons({ A: 17, B: 27, C: 22, D: 23 }, read, 20);
    const seen: string[] = [];
    buttons.start({ onPress: (letter) => seen.push(letter) });

    states['17'] = true;
    vi.advanceTimersByTime(20);
    expect(seen).toEqual(['A']);

    vi.advanceTimersByTime(20);
    expect(seen).toEqual(['A']);

    buttons.stop();
    vi.useRealTimers();
  });
});