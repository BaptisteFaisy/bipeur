# pager-pwa — design

Route: **design first** (A.13). The pager is the one place where the shape of
the artefact — a device, not a page — decides everything: keys, gestures,
offline behaviour, what a decision means. The design is written before the
requirements are refined, and the requirements below follow from it.

Package: `packages/pager` (React 19 + Vite 8 + `vite-plugin-pwa`).
Today: `src/main.tsx`, `src/App.tsx` (placeholder shell), `src/styles.css`,
`src/index.ts`. The lot A2 replaces the shell with the device.

## 1. The artefact

A pager is not a notification centre. Three consequences drive the design:

1. **The screen is the product.** 4 rows × 20 columns, 80 characters, printable
   ASCII, monospace. No card, no avatar, no paragraph.
2. **The gesture is the decision.** One key approves, one refuses, one scrolls.
   The risk level decides how much friction the gesture carries.
3. **It is always with you.** Installable PWA, works on a lock screen, keeps a
   memory of the last 50 pages, and tells the truth when it is offline.

## 2. Module layout

| Module | Role |
|---|---|
| `src/main.tsx` | Mount, service-worker registration. |
| `src/App.tsx` | Route-less shell: `Pager`, `Memory`, `Settings`, `Pairing`. |
| `src/pager/Screen.tsx` | 4 × 20 grid, one character per cell, `aria-live="polite"`. |
| `src/pager/Keys.tsx` | ✔ / ✖ / ▼, A–D when options exist, keyboard equivalents. |
| `src/pager/RiskLamp.tsx` | Colour **and** shape (circle, diamond, square) — BIP-N-05. |
| `src/pager/HoldToConfirm.tsx` | One-second press-and-hold for red pages. |
| `src/pairing/usePairing.ts` | QR handshake, ECDSA P-256 key generation. |
| `src/crypto/deviceKey.ts` | Non-extractable key pair in IndexedDB, signing. |
| `src/transport/ws.ts` | WebSocket client with backoff and offline detection. |
| `src/transport/decide.ts` | Builds and sends the signed decision. |
| `src/memory/store.ts` | Last 50 pages in IndexedDB. |
| `src/settings/store.ts` | Sound (off), vibration, quiet hours, budget, masking. |

`packages/core` supplies the line, the codes, the states and the claims — the
pager never re-implements a rule of the product.

## 3. Pairing and keys (BIP-F-15)

```
Central                         Pager
  POST /v1/pairings   ──▶  QR payload {pairing_id, url, nonce}
                                │  user scans / opens the URL
                                ▼
  GET  /v1/pairings/{id}  ◀──  pairing page
  POST /v1/devices        ◀──  { pairing_id, public_key_jwk }
        (single use, 5 min TTL, then 410)
```

The private key is generated with `crypto.subtle.generateKey({name:'ECDSA',
namedCurve:'P-256'}, false, ['sign'])`. `extractable: false` means the key can
never leave the browser, not even for the user — a stolen `localStorage` copy is
worthless. It is stored as a `CryptoKey` handle in IndexedDB.

## 4. The decision path (BIP-F-18)

```
tap ✔
  → claims = {page_id, fingerprint, verdict, choice, nonce, expires_at, device_id}
  → sig = sign(deviceKey, canonicalize(claims))          [@bipeur/core canonical]
  → POST /v1/pages/{id}/decision {claims, signature}
  → 202 accepted   → screen shows "SENT" and the queue advances
  → 409 rejected   → screen shows the reason, page stays pending
  → offline        → screen shows "NO NETWORK — NOT SENT"  (BIP-F-22)
```

The fingerprint comes from the page the human is **looking at**, not from a
stale store entry: that is what makes an orphan approval impossible rather than
unlikely.

## 5. Risk gestures

| Risk | Notification | In the app | Why |
|---|---|---|---|
| green | Approve / Refuse buttons where the platform allows | one tap | reversible, local |
| amber | opens the pager | one tap | touches the outside |
| red | opens the pager, no button | one-second hold | irreversible |

Red pages are never actionable from the notification shade, and never from a
locked screen without the hold. That is the whole point of the level.

## 6. Offline and honesty

- The WebSocket reconnects with exponential backoff; the header shows
  `OFFLINE` and the queue is frozen.
- A decision taken offline is **never** displayed as sent: it is queued and
  shown as `PENDING SEND`, and refused server-side anyway once its deadline
  passes (BIP-P-06).
- The pager never invents a page: the memory is a read-only view of what the
  Central delivered.

## 7. Decisions and their reasons

1. **Text, not canvas.** Every character is a real DOM text node: a screen
   reader can read a page, and the user can select it. A canvas would have been
   simpler and unusable (BIP-N-05).
2. **Colour plus shape.** The lamp is a colour *and* a glyph, so colour-blind
   users get the level (BIP-N-05).
3. **No sound by default.** The switch exists, starts off, and no flow depends
   on it (BIP-N-06). The intent to beep is an audit event.
4. **A service worker for delivery, not for logic.** It caches the shell and
   shows the push; it never decides, never signs, never queues a verdict.
5. **Two languages, one line.** UI strings in English and French (BIP-N-08); the
   page line stays ASCII whatever the UI language.

## 8. Tests

`packages/pager/test/` (Vitest + happy-dom, project `pager`):
screen rendering of a real composed line, key behaviour, hold-to-confirm timing
with a fake clock, offline banner, decision payload shape, memory cap at 50.
Playwright scenarios P1 (pairing), P2 (approve), P3 (destructive refusal) live in
`e2e/` and run outside PR CI.
