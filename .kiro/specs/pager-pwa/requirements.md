# pager-pwa — requirements

Route: design first (see `design.md`). Covers BIP-F-15 … BIP-F-23, plus the
non-functional requirements the pager carries alone (BIP-N-05, BIP-N-06,
BIP-N-07, BIP-N-08). Lot A2.

## Functional requirements

### BIP-F-15 (I) — Pairing

WHEN the user reads the QR code, THE PAGER SHALL create an ECDSA P-256 key pair
whose private key is not extractable, and register its public key with the
Central. The pairing link SHALL be single-use and SHALL expire after five
minutes.

- Accept: `crypto.subtle.generateKey(..., false, ['sign'])`; the handle is the
  only copy.
- Accept: a second use of the same pairing link answers `410`.

### BIP-F-16 (I) — Screen

THE PAGER SHALL display the current page on 4 rows of 20 columns, the number of
queued pages, the time and a risk lamp that combines a colour and a shape.

- Accept: a 80-character line fills exactly 4 × 20 cells, no clipping.
- Accept: the lamp has a text alternative for screen readers.

### BIP-F-17 (I) — Keys

THE PAGER SHALL offer approve, refuse and next, plus A to D when choices are
seeded. A red page SHALL require a one-second press-and-hold. Every action SHALL
have a keyboard equivalent.

- Accept: `Enter`/`y` approves, `Escape`/`n` refuses, `ArrowDown` scrolls,
  `a`…`d` pick an option.
- Accept: a 900 ms press on a red page does nothing and shows the remaining time.

### BIP-F-18 (I) — Signed decision

WHEN the user decides, THE PAGER SHALL send the page id, the fingerprint, the
verdict, a single-use nonce, a deadline and the signature over all of it. THE
CENTRAL SHALL verify the signature, the device, the fingerprint equality, the
deadline and the absence of replay before accepting.

- Accept: the signed string is `canonicalize()` of exactly those seven fields.
- Accept: a modified fingerprint produces `decision.rejected`.

### BIP-F-19 (S) — Push notification

WHEN a page is delivered and the pager is closed, THE SYSTEM SHALL send a Web
Push notification. For a green page the notification SHALL offer approve and
refuse where the platform allows it. For amber and red it SHALL open the pager.

- Accept: on a platform without action buttons the fallback is opening the
  pager — documented, not hidden (BIP-N-07).

### BIP-F-20 (S) — Memory

THE PAGER SHALL keep the last 50 pages with their decision and their latency.

- Accept: the 51st page evicts the oldest; the count never exceeds 50.

### BIP-F-21 (I) — Settings

Sound (disabled by default), vibration, quiet hours, hourly budget, masking of
the detail on a locked screen.

- Accept: a fresh install has `sound: false` and `mask: true`.

### BIP-F-22 (I) — Offline

WHILE the device has no network, THE PAGER SHALL display it and SHALL NOT present
a decision as sent.

- Accept: the banner reads `OFFLINE`, a queued decision reads `PENDING SEND`.

### BIP-F-23 (S) — Call back

WHEN the request carries a callback address, THE PAGER SHALL offer "Call back",
which opens the agent's session.

- Accept: only the `callback_url` declared by the station is clickable, and it
  was validated as `http(s)` on input.

## Non-functional requirements

| Id | Priority | Requirement |
|---|---|---|
| BIP-N-05 | I | Screen text is real text readable by a screen reader; AA contrast; no information by colour alone; animations disabled on request. |
| BIP-N-06 | I | No sound by default. No test, no recipe and no build agent triggers or listens to a sound; the intent to beep is the `beep.requested` audit event. |
| BIP-N-07 | I | Recent Chrome, Edge, Firefox; Safari on iOS 16.4 or later for the installed app. Notification action buttons are not available everywhere; the fallback is opening the pager. |
| BIP-N-08 | I | English by default, French available. The page line stays ASCII in both. |

## Properties touched

BIP-P-01 and BIP-P-02 are asserted again at the rendering boundary: what the
screen shows is what `composeLine` produced, character for character. BIP-P-06
is visible here as "a decision past its deadline never turns into an approval".

## Out of scope

Composing the line, classifying the risk, holding the queue, enforcing the
budget — all Central-side, all in `central-core`.
