# Watch companion — a second device on the wrist

The pager is an installable PWA on a phone. This note designs the « pager au
poignet »: a **watch companion** (WearOS, Garmin Connect IQ, or a plain JS
companion on the phone) that shows the latest page and reads it aloud, without
any new Central code.

The Central already models *one visitor, many devices* — pairing, polling and
deciding are all device-scoped. A watch is just another device row, and it
reuses the exact endpoints the PWA already speaks. Nothing in `packages/central`
changes.

## 1. Why nothing new is needed on the Central

| The watch wants | The endpoint that already does it | Code |
|---|---|---|
| Pair as a device | `POST /v1/devices` (register a public key against a six-character code) | `packages/central/src/routes/devices.ts`, `packages/central/src/pairing.ts` |
| Get the pending pages | `GET /v1/devices/:id/pages?state=pending` | `packages/central/src/routes/devices.ts` (`registerDeviceRoutes`) |
| Hear about a page without polling | `GET /v1/stream` (WebSocket, optional) | `packages/central/src/stream.ts` |
| Decide a page (optional) | `POST /v1/pages/:id/decision` (signed) | `packages/central/src/routes/pages.ts` |
| Mark a page read | `POST /v1/pages/:id/read` | `packages/central/src/routes/pages.ts` |

The contract the PWA codes against is in `packages/pager/src/api/client.ts`; the
watch implements the same client over raw HTTPS.

## 2. Pairing

The watch pairs exactly like a second phone. The flow is already exercised by
the PWA (`packages/pager/src/state/actions.ts`, `pair`):

1. A station the operator already trusts creates a **pairing code** the same way
   it does for a phone: `POST /v1/pairings` returns `{ pairing_id, code,
   expires_at, qr_url, pair_url }` (`packages/central/src/pairing.ts`
   `createPairing`). The code is single-use, lives five minutes.
2. The watch (or the phone's companion app acting for it) generates its own
   non-extractable ECDSA P-256 key, then registers it:
   `POST /v1/devices` with `{ code, device_name: "Beeper Watch",
   public_key_jwk }`. The Central consumes the code, stores the public key and
   answers `{ device_id, device_token }` (`packages/central/src/pairing.ts`
   `pairDevice`).
3. The watch keeps the **device token** (a bearer secret) and its **private
   key** (never leaves the watch). Only the hash of the token is stored
   (`BIP-N-03`).

Because the watch is its own device, pairing a watch never disturbs the phone's
device or its push subscription.

## 3. Polling

A watch has no reliable way to hold a WebSocket (battery, tethering), so it
polls. The pager answers resynchronise with the same route, so the watch reuses
it instead of inventing a "last page" micro-endpoint:

```text
GET /v1/devices/:id/pages?state=pending
Authorization: Bearer <device_token>
```

The handler (`packages/central/src/routes/devices.ts`) authenticates the device
(`authenticateDevice` in `packages/central/src/api-auth.ts`), rejects a caller
whose device id does not match the path, then returns:

```json
{
  "pages": [
    {
      "page_id": "pg_8j2…",
      "state": "pending",
      "line": "310 fw PUSH main>origin 3 commits +120-14",
      "code": 310,
      "risk": "amber",
      "detail": ["…"],
      "options": [],
      "station": "fw",
      "expires_at": 1763070000000,
      "callback_url": null
    }
  ]
}
```

The list is ordered oldest first — `pages[0]` is the page currently on the
phone's LCD (the queue head, `packages/central/src/store`, `listPages`). The
watch reads `pages[0].line` and displays it, optionally speaking it with the
same manual, settings-gated voice as the PWA (`packages/pager/src/api/speech.ts`).

A poll interval of a few seconds is enough: a page already waits for a whole
human decision, so a watch a few seconds behind is never late.

## 4. Deciding (optional)

The wrist can be **read-only**, or it can decide. The two designs:

- **Read-only (recommended for Garmin/WearOS).** The watch shows the line and
  buzzes; the human approves or refuses on the phone pager, which already owns
  the signing key and the hold gesture. Zero crypto on the watch.
- **Full decision.** The watch runs the same signing as the pager — build the
  signed claim (`packages/pager/src/state/decide.ts` `buildSignedDecision`) with
  its own key and `POST /v1/pages/:id/decision`. This needs a real ECDSA key on
  the watch (Connect IQ exposes it; WearOS does through Android Keystore) and is
  strictly more surface area.

For a first wrist, keep it read-only: the value is seeing the page and hearing
the line, not forging a signature two centimetres from the phone that owns it.

## 5. The loop, end to end

```
station ── POST /v1/pairings ─────────▶ code (5 min)
watch   ── POST /v1/devices {code,jwk}▶ device_id, device_token
watch   ── loop ──────────────────────▶ GET /v1/devices/:id/pages?state=pending
            │  pages[0] = newest pending
            ├─ display line, speak it (settings-gated, manual)
            └─ (optional) read-only: wait for the phone to decide
               (optional) deciding:  POST /v1/pages/:id/decision (signed)
```

No Central code, no new schema, no new daemon: the companion is a second
`devices` row reaching the endpoints the first one already uses.