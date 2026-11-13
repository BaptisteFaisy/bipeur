---
inclusion: always
---

# Tech — stack, versions, hard rules

## Stack

| Concern | Choice | Note |
|---|---|---|
| Language | TypeScript, `strict: true` | `tsconfig.base.json` is the single source; a package never weakens it |
| Runtime | Node.js ≥ 22.13 | `node:sqlite` must be available |
| Modules | ESM only, `"type": "module"`, `moduleResolution: NodeNext` | **every relative import ends with `.js`** |
| Packages | pnpm workspaces | `packages/*` + `e2e` |
| HTTP | Hono + `@hono/node-server` | |
| Storage | `node:sqlite` (`DatabaseSync`) | one file, `BIPEUR_DB`; no native build |
| Realtime | `ws` (WebSocket) + `web-push` | |
| UI | React 19 + Vite + `vite-plugin-pwa` | the pager is an installable PWA |
| Validation | Zod, on **every** inbound payload | |
| Rules file | YAML (`yaml`) | `.bipeur/rules.yaml` |
| Tests | Vitest (unit) + fast-check (properties) | Playwright only in `e2e/`, never in PR CI |
| CI | GitHub Actions on self-hosted runners | every job `timeout-minutes: 5`, `concurrency`, `fetch-depth: 1` |

## Hard rules

1. **No new dependency without saying so.** The dependency table in `README.md`
   and the lockfile are reviewed; a PR that adds a package states why and gives
   its licence. Strong copyleft (GPLv3, AGPL) is refused.
2. **Files < 500 lines, functions < 50 lines.** `contest-guard` enforces it
   (`.github/checks/repo_rules.py`). Split into modules instead of growing.
3. **No duplication.** A helper used twice moves to `packages/core`.
4. **Never commit `pnpm-lock.yaml` by hand** and never resolve it by hand: it is
   generated (`pnpm install`) and marked `merge=binary`.
5. **No secret in the tree.** Station tokens are stored hashed (`hashToken`),
   the audit log carries fingerprints only, never payloads (BIP-N-03).
6. **No sound.** No API, no test, no build step triggers or listens to a sound
   (BIP-N-06). The intent to beep is proved by the `beep.requested` audit event.
7. **LLM calls are optional and off by default**, behind a provider interface,
   with a model-free path for every feature. No secret and no personal data is
   ever sent to a model.
8. **Fail closed.** If the Central is unreachable, a hook refuses the tool with
   a clear reason; a page that expires is a refusal, never an approval.

## Commands

```bash
pnpm install            # frozen lockfile in CI
pnpm typecheck          # tsc, no emit, whole workspace
pnpm lint               # eslint flat config
pnpm test               # vitest: projects unit | props | pager
pnpm build              # tsc per package + vite build for the pager
node tools/smoke-central.mjs   # boots the Central and checks the API
pnpm e2e                # Playwright P1…P7 (outside PR CI)
```

## Environment

`BIPEUR_HOST`, `BIPEUR_PORT`, `BIPEUR_DB`, `BIPEUR_RULES`,
`BIPEUR_BOOTSTRAP_TOKEN`, `BIPEUR_BUDGET_PER_HOUR`, `BIPEUR_RETENTION_DAYS`,
`BIPEUR_VAPID_*`, `BIPEUR_SNPP_HOST`, `BIPEUR_SNPP_PORT`, `BIPEUR_DEMO`,
`BIPEUR_URL`, `BIPEUR_TOKEN`, `BIPEUR_LLM_*` — see `.env.example`. Every one has
a safe default; the demo runs with none of them set.
