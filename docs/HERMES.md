# Hermes — résolveur de conflits

Quand une PR entre en conflit avec `main`, GitHub ne crée **aucun** run
`pull_request` : la PR est morte jusqu'à ce que quelqu'un la rebase. Le
résolveur Hermes fait ce travail, et **il ne devine jamais** : soit il prouve que
son résultat est bon (toolchain du dépôt verte), soit il escalade à un humain.

## Flux

```
PR en conflit avec main
        │
        ▼
hermes-lite.yml  (gate, gate.py)
   constate `mergeable_state: dirty`
   → check rouge « Conflits avec main »
   → label `hermes/conflit`
   → sortie `conflict_prs` → dispatch `hermes-conflict-resolver.yml`
        │
        ▼
hermes-conflict-resolver.yml  (workflow_dispatch, un run par PR)
        │
        ▼
.github/hermes/resolver.py
   1. lit la PR (branche, base, head SHA) — refuse les forks
   2. git fetch + git checkout -B <branche> <head SHA>
   3. git rebase origin/main
        │  conflit ?
        ▼
      .github/hermes/resolve.py   (fichier par fichier)
        ├─ fichier dérivé          → régénéré par la toolchain, puis `git add`
        ├─ identique des 2 côtés   → gardé tel quel
        ├─ package.json            → fusion JSON clé par clé (aucune perte)
        ├─ binaire qui diffère     → NON résolu (un humain tranche)
        └─ source                  → InferHub (combo/cheap, meta-routeur),
                                     puis repli déterministe, sinon NON résolu
        │
        ▼
   4. VALIDATION obligatoire, avec la toolchain du dépôt :
      pnpm install --frozen-lockfile → typecheck → lint → test → build
      un check rouge **déjà rouge sur origin/main** est signalé, pas bloquant ;
      un check rouge **introduit** par la résolution bloque le push
        │
        ├── tout est prouvé → git push --force-with-lease sur LA branche de la PR
        │                     + commentaire structuré + label `hermes/resolu`
        └── sinon           → git rebase --abort, label `hermes/conflit`,
                              commentaire avec la raison exacte, sortie ≠ 0
```

## Garanties

| Garantie | Comment elle tient |
|---|---|
| Jamais de push sur `main` | `push HEAD:refs/heads/<branche de la PR>`, jamais autre chose |
| Jamais de push sur la branche d'autrui | la branche vient de la PR ; les forks sont refusés |
| Jamais d'écrasement silencieux | `--force-with-lease=refs/heads/<branche>:<head SHA>` : si quelqu'un a poussé entre-temps, le push est **refusé** |
| Jamais de valeur de secret exposée | noms seuls (`INFERHUB_API_KEY`, `HERMES_PUSH_TOKEN`) ; le jeton de push est remis à git par `GIT_ASKPASS`, jamais en argument de commande |
| Jamais d'échec silencieux | sans clé LLM : 100 % déterministe ; si rien ne prouve le résultat : label + commentaire + sortie ≠ 0 |
| Jamais de timeout tué sans explication | `resolver.py` s'arrête à 270 s (`HERMES_BUDGET_SECONDS`) et escalade **avant** le `timeout-minutes: 5` du job |

## Fichiers dérivés (jamais soumis à l'IA)

Un modèle qui réécrit un fichier généré produit quelque chose de plausible et de
faux : duello l'a payé (fichier généré tronqué → typecheck cassé → douze PR
bloquées). Ces chemins sont donc **régénérés** par la toolchain du dépôt :

| Chemin | Régénération | Pourquoi |
|---|---|---|
| `pnpm-lock.yaml` | `pnpm install --lockfile-only` | généré par pnpm, `merge=binary` dans `.gitattributes` |
| `packages/pager/dist/**`, `**/dist/**` | `pnpm build` | sortie tsc/Vite des packages, jamais écrite à la main |
| `packages/pager/dev-dist/**` | `pnpm build` | service worker PWA émis par le build |
| `coverage/**` | `pnpm test` | rapport de couverture Vitest, artefact de run |
| `*.tsbuildinfo` | `pnpm typecheck` | cache incrémental de tsc, réécrit à chaque typecheck |
| `e2e/playwright-report/**` | `pnpm e2e` | rapport HTML Playwright |
| `e2e/test-results/**` | `pnpm e2e` | résultats bruts Playwright |

Les binaires (`.png`, `.woff2`, `.ico`, `.wasm`…) ne sont jamais soumis à l'IA :
identiques des deux côtés → gardés, sinon **non résolus** (un humain tranche).

## Ordre d'activation

1. **Secrets** (dépôt → Settings → Secrets and variables → Actions) :
   - `INFERHUB_API_KEY` — jambe LLM directe (**déjà posé** sur le dépôt).
     Absent : le résolveur reste déterministe et escalade plus souvent, il ne
     casse pas. Le modèle par défaut `combo/cheap` est le **meta-routeur**
     InferHub : le modèle réel qui répond peut changer sous nous, d'où les
     garde-fous sur la réponse (`accept_llm_output` : vide, marqueurs de
     conflit restants ou taille aberrante ⇒ rejet et repli déterministe).
     Surcharge possible via la variable `HERMES_LLM_MODEL`.
   - `HERMES_PUSH_TOKEN` — PAT fine-grained `contents: write` sur ce dépôt.
     Absent : le repli est `github.token`, dont les push **ne déclenchent aucun
     workflow** (anti-récursion GitHub) : la CI ne serait pas relancée sur le
     head résolu, et il faudrait un `@Mergifyio refresh` manuel.
2. **Sortie de dry-run** : tant que la variable `HERMES_LITE_DRY_RUN=1` existe,
   le gate ne merge pas et le résolveur est dispatché en `mode: dry-run` (rebase
   + résolution + validation, **aucun push, aucun label**). Lire les logs d'un
   run `dry-run` sur une PR en conflit, puis supprimer la variable.
3. **Premier vrai conflit** : `mode: apply`. Le résolveur pousse, commente,
   étiquette. Vérifier que la CI repart sur le head poussé (d'où
   `HERMES_PUSH_TOKEN`) et que la PR entre en file Mergify.
4. **Lancement manuel** possible à tout moment :
   `gh workflow run hermes-conflict-resolver.yml -f pr_number=<N> -f mode=dry-run`.

## Budget

`hermes-lite` et `hermes-conflict-resolver` sont bornés à `timeout-minutes: 5`,
comme tous les jobs du dépôt : `.github/ci-budget/check_timeouts.py` n'a pas de
notion de déclencheur et refuse tout job au-delà de 5 min. Le résolveur n'est
pas un job de PR (aucun verdict de PR n'en dépend, Mergify ne l'attend pas),
mais il n'a pas besoin de plus : la validation complète mesure ~35 s à chaud
(install 5 s, typecheck 10 s, lint 2 s, test 2 s, build 16 s) et ~2 min à froid.
Le garde-fou interne (270 s) transforme un dépassement en escalade explicite au
lieu d'un job tué sans commentaire.

## État connu du dépôt

Une PR **en conflit** ne reçoit **aucun** run `pull_request` (GitHub ignore
`opened`/`synchronize` d'une PR non mergeable) : le gate la voit donc via un
événement `check_run` (un autre workflow qui finit sur le même head) ou via un
`workflow_dispatch` manuel. `hermes-lite-alert` liste à la demande les PR portant
`hermes/conflit`, et `gh workflow run hermes-conflict-resolver.yml -f pr_number=N`
suffit à lancer la résolution sur une PR précise.

`pnpm lint` est **déjà rouge sur `main`** (`tools/smoke-central.mjs` : 16 erreurs
`no-undef`, ESLint ne connaît pas les globales Node pour `.mjs`). C'est
exactement pourquoi la validation compare au moins une fois avec
`origin/main` avant de bloquer : sans cela, le résolveur n'aurait jamais le
droit de pousser. Corriger ce lint est une tâche séparée.

## Actions user restantes

- [x] Secret `INFERHUB_API_KEY` posé (jambe LLM InferHub) — rien à faire.
- [ ] Poser le secret `HERMES_PUSH_TOKEN` (PAT fine-grained `contents: write`) —
      sinon pas de relance de CI sur le head résolu.
- [ ] Merger cette PR (elle-même passe par la file Mergify : `ci-budget`,
      `typecheck`, `lint`, `test`, `build`, `contest-guard`).
- [ ] Lancer un premier `mode: dry-run` sur une PR réellement en conflit, lire
      le rapport, puis supprimer `HERMES_LITE_DRY_RUN` pour passer en `apply`.
- [ ] Corriger (hors chantier) le lint pré-existant de `tools/smoke-central.mjs`.
