---
inclusion: always
---

# Structure — tree, naming, ownership

```
bipeur/
├── .bipeur/rules.yaml          # the rules file, read by the hook AND the Central
├── .github/
│   ├── actions/setup/          # composite: checkout + toolchain + install
│   ├── checks/                 # contest_guard.py, repo_rules.py (stdlib only)
│   ├── ci-budget/              # check_timeouts.py (5-minute budget)
│   ├── hermes/                 # gate.py + the conflict resolver
│   └── workflows/              # ci, contest-guard, ci-budget, hermes-lite, e2e …
├── .kiro/                      # TRACKED. steering, specs, hooks, agents, skills, settings
├── docs/                       # architecture, SNPP transcript, art direction, threat model
├── e2e/                        # Playwright P1…P7 — never in PR CI
├── packages/
│   ├── core/                   # the shared contract (no Node API in src/index.ts)
│   ├── central/                # Hono API, SQLite store, WS stream, audit, simulator
│   ├── pager/                  # React + Vite PWA
│   ├── hook/                   # bip-hook (Kiro PreToolUse) + bip-notice
│   ├── mcp-server/             # page_human, page_wait, page_cancel
│   ├── snpp/                   # RFC 1861 gateway
│   ├── cli/                    # bip
│   └── crew-app/               # Kiro Crew app (app.json + page + background)
└── tools/                      # smoke tests and small generators
```

## Ownership, so parallel work never collides

Each package is owned by one agent and one branch. A PR touches **one** package
plus, when unavoidable, its own entry in a root table. Nobody edits another
package: cross-package needs go through `packages/core`.

| Path | Owner |
|---|---|
| `packages/core/**` | contract keeper (parent agent) |
| `packages/central/**` | central |
| `packages/pager/**` | pager |
| `packages/hook/**`, `packages/mcp-server/**` | adapters |
| `packages/snpp/**` | snpp |
| `packages/cli/**`, `packages/crew-app/**` | cli-crew |
| `.kiro/**`, `README.md`, `KIRO_JOURNAL.md`, `docs/**` | kiro-docs |
| `e2e/**`, `tools/**` | e2e |
| `.github/hermes/**`, `.mergify.yml` | ci-hermes |

## Naming

- Files: `kebab-case.ts`. React components: `PascalCase.tsx`.
- Tests: `*.test.ts` (unit), `*.props.test.ts` (property tests), `e2e/*.spec.ts`.
- Identifiers, API paths, environment variables, commit messages and user-facing
  strings: **English** (the submission is in English; French is a second UI
  language only).
- Requirement ids: `BIP-F-nn` (functional), `BIP-N-nn` (non-functional),
  `BIP-P-nn` (property). Every test names the id it proves.
- Branches: `feat/<package>-<subject>`, `fix/<package>-<subject>`,
  `docs/<subject>`, `ci/<subject>`.

## Module contract

- `packages/core/src/index.ts` is **browser-safe**: no `node:` import. Node-only
  helpers (hashing, ECDSA verification, ids) live in `src/node.ts`, exported as
  `@bipeur/core/node`.
- Every package exposes `src/index.ts` and, when it is runnable, `src/bin.ts`
  declared in `bin`.
- The Central serves `packages/pager/dist` when present: one process, one file,
  one URL (BIP-N-09).
- Storage goes through `packages/central/src/store/` — an interface plus a
  `node:sqlite` implementation, so a restart never loses a pending page
  (BIP-P-12).

## Where a decision is written down

A design decision goes into the relevant `.kiro/specs/<lot>/design.md` and, when
it changes behaviour, into `KIRO_JOURNAL.md`. Code comments explain *why*, never
*what*.
