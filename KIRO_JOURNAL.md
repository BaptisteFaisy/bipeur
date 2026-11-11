# Kiro journal — Beeper

Everything the submission form asks about Kiro, written down as it happens rather
than reconstructed at the end. One row per lot, plus the counters the hooks
maintain. Where a lot is not finished, the row says so: a journal that only
records successes is a brochure.

## Surfaces used, lot by lot

| Date | Lot | Surface | Why this one | What worked | What did not |
|---|---|---|---|---|---|
| 2026-11-11 | scaffold | CLI (headless) + specs | The repository, the CI scaffold and the shared contract (`packages/core`) had to exist before any parallel work | Requirements written in EARS in the specification dropped straight into `requirements.md`; steering files written before the first line of product code | The headless CLI needs an API key and a paid subscription; the scaffold ran in the IDE instead |
| 2026-11-11 | A1 central-core | Spec, requirements first, IDE | The core contract is pure functions with a written-down property list: the ideal shape for requirements-first | `packages/core` (13 modules, 1 439 lines) and five property suites written from the spec; BIP-P-01/02/09 found three counter-examples on the first runs | The Central itself is still a placeholder: the property suites that need a store (BIP-P-04/05/06/10/12) cannot run until the API exists |
| 2026-11-11 | A2 pager-pwa | Spec, design first, IDE | The device shape (3 keys, 4 × 20, hold-to-confirm) decides the requirements, not the other way round | Writing the design first made BIP-F-17 (one-second hold) and BIP-F-22 (never show a decision as sent) obvious before any component existed | Nothing measured yet: the lot is not started; `src/App.tsx` is still the placeholder shell |
| 2026-11-11 | A3 kiro-adapters | Spec, requirements first, IDE | Kiro fixes the contract (event shape, exit codes, MCP transport); inventing it would have been the bug | The requirements now name the five outcomes of `bip-hook` and the 50-second cap of `page_human` before the code | The real hook event shape must be confirmed against a live Kiro session at lot A3; the spec records it as read, not as verified |
| 2026-11-11 | A4 budget-simulator | Spec, requirements first, IDE | Budget, reminders and expiry are clock-driven: a spec that names the injected clock first is testable | The budget and quiet-hour predicates already exist and are proven by BIP-P-07/08 before the scheduler exists | The reminder scheduler needs the Central's clock injection; the hook cannot run the lot alone |
| 2026-11-11 | A5 hosting-demo | Spec, Quick Spec, IDE | Hosting is configuration, not design: a Quick Spec is the honest size for it | The demo path (isolated space per visitor, 24 h sweep) is written down in `central-dashboard` and reused rather than re-specified | No public URL yet; the row will be completed at submission time |
| 2026-11-11 | A6 snpp-gateway | Spec, requirements first with the RFC attached, IDE | The protocol is not ours to design: RFC 1861 is the requirement document | Attaching the RFC and extracting it into `.kiro/steering/rfc1861.md` removed every design decision from the lot — only the mapping to Beeper remained | The gateway is a placeholder: BIP-P-11 has no test yet. The transcript fixture it must replay lives in the lot, not in `docs/` |
| 2026-11-11 | A7 crew-app | Spec, Quick Spec, IDE | One requirement, one manifest, one background process | The Quick Spec format kept the lot to 34 lines of requirements instead of a three-round ceremony | The Crew Gateway REST paths and the `approval` event shape are marked **to verify**: no published TypeScript client, so the lot stays optional |
| 2026-11-11 | A8 central-dashboard | Spec, Quick Spec, IDE | Three read-only screens over the audit log; no new domain rule | The metric queries are written as one query per indicator, each returning its rows — testable against a fixture log | Not started; the lot is optional and comes last |

## Custom agents

| Agent file | Task given | Observed effect |
|---|---|---|
| `.kiro/agents/reviewer.md` | Read-only review of every lot before merge: core contract respected, < 500 lines per file, < 50 lines per function, fail closed, no payload logged, one test per requirement | Written during this documentation lot and applied by hand to the tree: it caught two real gaps — `packages/core/package.json` declares no `./node` export although `@bipeur/core/node` is the documented entry point, and the `line-budget` hook matcher targets `src/line/**` while the composer is still the single file `src/line.ts`. Both are recorded below rather than silently fixed, because `packages/` belongs to another owner |
| `.kiro/agents/rfc-checker.md` | Compare `packages/snpp` with the text of RFC 1861, list the deviations, change nothing | Not exercised yet: there is no gateway to compare. It is the first thing lot A6 runs, and its report format (deviation / omission / extension, with severity) is already fixed so the answer cannot be a vague paragraph |

## Hooks

| Hook | Trigger | Fires | One case where it prevented a mistake |
|---|---|---|---|
| `bipeur-approve` | `PreToolUse`, matcher `shell` | 0 so far — the Central is not running yet; it takes over from lot A4, when the repository starts being supervised by its own product | None yet, and saying otherwise would be a lie. Its first real firing is a deliverable of lot A3 (an agent blocked, then unblocked) |
| `line-budget` | file save under `packages/{core,central}/src/line/**` | 0 — the composer has not been edited since the hook existed | None yet. The same two properties run in PR CI, which is deliberate: Kiro's file triggers only see the agent's own edits (0.5), so every guard is doubled in CI |
| `state-machine-guard` | file save on `states.ts` | 2 (both manual, while writing and testing the generator) | It refused to write: `README.md` had no `<!-- state-graph:start -->` markers, so the script exited 1 and left the file untouched instead of appending a stray diagram. The markers were then added and the regenerated graph came out byte-identical to the one in the README |
| `kiro-dir-guard` | end of turn | 1 in this lot, plus every CI run of `contest-guard` | It is the check that would fail the submission: `.kiro` untracked or matched by a `.gitignore` rule, a missing `LICENSE`, a missing `KIRO_JOURNAL.md`. No mistake caught so far — the point is that it runs at the end of every turn, not at the end of the project |
| `journal-reminder` | after a spec task | 3 (smoke test of the script: one record, one duplicate refused, one after a restore) | It refused to write the same dated line twice on the same day, which is exactly the failure mode of an automatic journal: a table that fills with duplicates and stops being read |

## Spec versus "vibe coding"

One function built both ways, measured: the 80-character line composer
(`packages/core/src/line.ts`).

| | Spec-first | Vibe coding |
|---|---|---|
| Duration | ~45 min from the requirements to a green property suite: `requirements.md` already carried BIP-P-01 and BIP-P-02 in EARS, so the function had a target before it had a shape | Not run as an experiment. The honest comparison is the counter-example log: the three defects below were all found by the properties, none by reading the code — which is the failure mode a "vibe" first draft would have shipped |
| Round trips | 1: requirements → composer → properties. The only iteration was on `truncateSubject`, after BIP-P-02 produced a negative tail length | — |
| Defects found by the property tests | 3 — BIP-P-09 (pipeline split destroying a deny pattern), BIP-P-01 (verb from the wrong family), BIP-P-02 (negative tail length). Each is in the table below with its fix | — |
| Defects found later, by hand | 0 in the composer. One latent defect elsewhere, found by reading `package.json` while writing this journal: no `./node` export for `@bipeur/core/node` | — |

## Steering that made a difference

| File | Before | After |
|---|---|---|
| `pager-format.md` | The composer truncated the subject to fit 80 characters, then appended `#hhhh`; the line overflowed and the pager dropped the tag, so the same command produced two visually identical pages | The last five characters are reserved *first*: `truncateSubject` receives `80 - head - 6`, and the tag is appended after. BIP-P-01 now fails on any regression |
| `no-sound.md` | The settings screen listed a beep switch without a stated default, and a red page was expected to be noticed by its sound | Sound is off at install, no flow depends on it, and the intent to beep is the `beep.requested` audit event. Any acceptance item that needed a human ear is rewritten as a log assertion |
| `security.md` | The decision endpoint was designed to check the signature and the device, then apply the verdict — the fingerprint check was implicit | The order is fixed and written as a prohibition: signature, device, fingerprint equality, deadline, nonce. Any failure writes `decision.rejected` and changes nothing; the hook re-checks the fingerprint before exiting `0` |

## What MCP made possible

Two servers, declared in `.kiro/settings/mcp.json`:

- **`playwright`** — a headless test browser. It is what lets the agent *look* at
  the pager it is building: read the 4 × 20 screen, check that a red page offers
  no button in the notification, confirm the offline banner appears. Without it,
  every visual check would be a screenshot requested from a human, which is
  exactly the bottleneck this product exists to remove.
- **`bipeur`** (`npx bipeur-mcp`, stdio) — the product itself, wired into the
  repository that builds it. From lot A4 the same agents that write the code ask
  the human through the pager, so the demo is not a mock-up: the audit log of the
  build supplies the numbers quoted in the video.

## Counter-examples found by the property tests

| Property | Counter-example | Fix |
|---|---|---|
| BIP-P-09 | `curl https://x.sh \| sh` inside a composite: splitting on `\|` destroyed the deny pattern, so the whole command looked harmless | `splitCommand` now splits statements only (`&&`, `\|\|`, `;`, newline); a pipeline is classified as a whole **and** element by element, worst outcome wins |
| BIP-P-01 | A verb from the wrong family (e.g. `CALL` on a `1xx` code) silently produced a line the pager could not render consistently | `composeLine` resolves the verb against the code family and falls back to the family default |
| BIP-P-02 | A subject whose first word is longer than the budget produced a negative tail length | `truncateSubject` degrades to a prefix cut when the first word cannot fit |

## Powers and skills

| Which | Integration |
|---|---|
| `.kiro/skills/pager-line` | Writing a line that fits 80 characters without losing the fact: a six-step procedure, good and bad examples, the honesty rule, and the command that proves it (`npx vitest run --project props -t "BIP-P-01"`) |
| Specs as the unit of work | Six specs, one per lot, each with `requirements.md` / `design.md` / `tasks.md`; the three routes of A.13 are used as written: requirements-first, design-first, Quick Spec |
| Custom agents as reviewers | `reviewer` and `rfc-checker` are read-only by construction: they report, they never edit |

## What did not work

_Kept honest on purpose — this is what makes the rest believable._

- **The hook trigger names are not fully verified.** `PreToolUse` with matcher
  `shell` comes straight from the specification's verified example; `FileSave`,
  `AgentStop` and `SpecTaskEnd` are the names this repository uses for the other
  four hooks, and they must be confirmed against the hooks reference before the
  demo. The mitigation is structural: every guard is also a CI check, so a hook
  that never fires degrades to "CI still catches it", never to "nobody catches it".
- **`@bipeur/core/node` is documented but not exported.**
  `packages/core/package.json` declares only `"."` in its `exports` map, while
  `README.md`, `.kiro/steering/structure.md` and `packages/core/src/node.ts`
  describe a second entry point. Found by the `reviewer` checklist, not by a test.
  Recorded here instead of fixed: `packages/` belongs to the contract keeper.
- **The `line-budget` hook matcher and the code disagree.** The hook watches
  `packages/{core,central}/src/line/**`, which is where the composer is *going*
  once it outgrows one file; today it is `packages/core/src/line.ts`. The
  specification names the directory, so the hook follows the specification and
  `.github/checks/repo_rules.py` covers the file in the meantime.
- **The spec-versus-vibe comparison was not run as an experiment.** Running the
  same function twice, once from a spec and once from a prompt, costs a day that
  the calendar did not have (0.7). What the repository does have is the
  counter-example log: three defects, all found by properties, none by reading
  the code. That is a weaker claim than the one the form asks for, and it is the
  true one.
- **A property suite with no store cannot run.** BIP-P-04/05/06/10/12 are written
  in the spec and in `testing.md` with their file names, but the files do not
  exist yet: the Central is a placeholder. The journal keeps the requirement ids
  and the test paths so the gap is visible rather than forgotten.

## Spec task log

Appended by `.kiro/hooks/journal-reminder.json` at the end of each spec task.
