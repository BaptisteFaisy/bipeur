# Art direction

The retro stops at the pager's shell. The Central is sober, because the person
looking at it is working, not nostalgic.

## 1. The device

| Element | Choice | Why |
|---|---|---|
| Casing | Dark, slightly translucent plastic, rounded corners, a belt clip | The object people actually carried in 1995; a rectangle would read as "a card" |
| Screen | Grey-green LCD, 4 rows × 20 columns, matrix characters | The capacity is the product: 80 characters is a constraint, not a style |
| Keys | Three: ✔ approve, ✖ refuse, ▼ next; A–D appear only when options exist | The gesture is the decision; a fourth permanent key invites browsing |
| Lamp | Colour **and** shape: green circle, amber diamond, red square | Colour alone is not information (BIP-N-05) |
| Queue counter | `3/6` — three pending, six this hour | The budget is part of the promise; show it |
| Weight in the hand | Large tap targets (≥ 44 px), one-thumb reach | Used at 11 pm, half asleep |

No manufacturer's mark, real or evocative. The object is generic on purpose.

## 2. Type: no font to download — a decision, not an omission

**The matrix look is produced by the system monospace stack, not by a webfont.**
The CSS is:

```css
font-family: "Courier New", ui-monospace, SFMono-Regular, Menlo, monospace;
font-variant-ligatures: none;
letter-spacing: 0.04em;
```

Consequences, stated plainly because they are the reason for the choice:

- **No font file is downloaded, bundled or served.** The pager is a PWA meant to
  work offline on the first load, on a phone, in a venue with bad Wi-Fi.
- **There is no font licence to verify.** The specification marked the licence of
  VT323 / DotGothic16 as *to verify*; the answer here is that we do not ship a
  font at all, so the question disappears. This is deliberate: a bundled webfont
  would add a licence to the dependency table and a 40 KB download to the first
  paint, for a decorative gain.
- The README's "Fonts" line says exactly this. If a licensed OFL matrix font is
  ever bundled, it must be OFL or equivalent and listed in the dependency table
  first.

## 3. Screens, and the states that are usually forgotten

1. **Pager** — the main screen, built for a phone.
2. **Memory** — the last 50 pages with their decision and latency.
3. **Settings** — sound (off), vibration, quiet hours, budget, devices, masking.
4. **Central** — stations, queue, history, indicators, rules bench. Large screen,
   AA contrast, no retro.
5. **Pairing** — QR code and state.
6. **Demo** — the simulator and a shortcut to the pager.

The states that make a product feel finished:

| State | Copy |
|---|---|
| No page | `No pages. Your agents are fine.` |
| Offline | `OFFLINE` banner, decisions shown as `PENDING SEND`, never as sent |
| Device revoked | `This pager was revoked. Pair again to continue.` |
| Page expired while reading | the screen freezes on the line, then `EXPIRED — nothing was sent` |
| Queue full | `QUEUE FULL — the budget will deliver them together` |

Each of these is a real screen in the design, not a fallback string.

## 4. Contrast and motion

- Body text on the LCD: ≥ 4.5:1 (AA). The grey-green background is deliberately
  light enough that dark text passes; the "authentic" dark green LCD with dim
  characters does not, and authenticity loses.
- The risk lamp colour is never the only carrier: shape + text alternative.
- No animation by default. A transition is allowed only for the lamp, is under
  150 ms, and is removed entirely under `prefers-reduced-motion: reduce`
  (BIP-N-05).
- Text is real text: selectable, zoomable, readable by a screen reader. No
  canvas, no image of a screen, no `aria-hidden` on content.

## 5. The Central, and the contrast of tone

The Central is a working tool: light background, one accent colour, tables that
align, numbers that can be compared. The retro is a memory of the object, not a
theme for the whole product. A judge should be able to tell in one second which
screen is the toy and which is the instrument — and understand that the toy is
the serious one.
