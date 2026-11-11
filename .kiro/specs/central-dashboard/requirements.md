# central-dashboard — requirements (Quick Spec)

- **Route:** Quick Spec (A.13). Three screens, read-mostly, no new domain rule:
  the dashboard is a view over the audit log, not a subsystem.
- **Covers:** BIP-F-30, BIP-F-31, BIP-F-32. Lot A8 (optional).
- **Where:** served by the Central (`packages/central`), on the big screen.

## BIP-F-30 (S) — Dashboard

THE SYSTEM SHALL show active stations, pending pages, a filterable history and
the indicators of A.3.

- Accept: every indicator is computed from the `events` table — decision latency
  median, filter rate, delivery p95, unblocked time, orphan approvals.
- Accept: the history filters by station, code, risk and state.
- Accept: no payload text is displayed in the history, only the line and the
  fingerprint.

## BIP-F-31 (I) — Simulator

In demonstration mode, THE CENTRAL SHALL play three fictional agents that emit
varied requests, in a space isolated per visitor and wiped after 24 hours.

- Accept: `BIPEUR_DEMO=1` and one click on "Start demo" give a working pager.
- Accept: two visitors never see each other's pages (isolation by space id).
- Accept: the space is wiped after 24 h; no account, no installation.

## BIP-F-32 (S) — Rules bench

WHEN the user pastes a command, THE SYSTEM SHALL show the line, the code and the
level it would produce, without creating a page.

- Accept: `POST /v1/rules/dry-run` returns `{line, code, risk, matched_rule}`
  and writes no `page.*` event.
- Accept: the bench shows which rule matched, so a wrong classification is
  fixable in one edit of `.bipeur/rules.yaml`.

## Constraints

| Id | Constraint |
|---|---|
| BIP-N-03 | The dashboard reads the audit log; it never reads payloads. |
| BIP-N-04 | Demo spaces are ephemeral; nothing survives 24 h. |
| BIP-N-05 | AA contrast; the retro look stops at the pager (A.11) — the Central is sober. |
