# crew-app — requirements (Quick Spec)

- **Route:** Quick Spec (A.13). One requirement, one manifest, one background
  process; a full three-round spec would cost more than the lot.
- **Covers:** BIP-F-27. Lot A7 (optional, bonus "Best Kiro Crew App").
- **Package:** `packages/crew-app` (`app.json`, a page, a background process).

## BIP-F-27 (S) — Kiro Crew app

WHEN the Crew Gateway emits an approval event, THE APP SHALL create the
corresponding page, and on a decision SHALL call the approval resolution.

- Accept: an `approval` event produces a page whose `source.kind` is `crew`.
- Accept: an approved page calls the resolution with `approve`; a denied page
  calls it with `deny` **and the human's reason**, so the agent can change course.
- Accept: an expired page resolves as `deny` — never as an approval (BIP-F-07).
- Accept: the declared permissions are limited to the approval and notification
  paths.

## Constraints

| Id | Constraint |
|---|---|
| Fail closed | If the Gateway is unreachable when a decision arrives, the app retries with the same idempotency key and never resolves twice (BIP-N-02). |
| No secret in the tree | The Gateway token comes from the environment, never from `app.json`. |
| No sound | The app has no audio path (BIP-N-06). |

## Open question

The exact REST paths and the shape of the `approval` event are marked
**to verify** in the specification: no published TypeScript client exists for
the Gateway, so the background process calls REST and WebSocket endpoints
directly. This is written down before coding, and the lot is optional for that
reason.
