# The GitHub Action — a deploy that needs a human (BIP-F-48)

Every other adapter pages from a machine the agent already owns: the Kiro hook,
the MCP server, `bip`, SNPP. The deploys that matter do not happen there — they
happen in CI, on a runner, where nothing but a workflow step can stop them. This
is that step.

Two actions ship in this repository, both plain JavaScript, no build, no
dependency, no install:

| Action | Asks | Fails the job when |
|---|---|---|
| `.github/actions/gate` | *may this command run, on this commit?* | anything but a human `approve` |
| `.github/actions/gate-pr` | *may this pull request ship, at this head SHA?* | anything but a human `approve` for that commit |

```yaml
- name: Page the human
  id: gate
  uses: Tradoooo/bipeur/.github/actions/gate@main
  with:
    url: ${{ vars.BIPEUR_CENTRAL_URL }}
    token: ${{ secrets.BIPEUR_STATION_TOKEN }}
    command: flyctl deploy --ha=false -a bipeur-web
    timeout-minutes: 15

- name: Deploy            # runs only if the step above exited 0
  run: flyctl deploy --ha=false -a bipeur-web
```

A complete example that gates a release is in
[`examples/github-action-deploy.yml`](../examples/github-action-deploy.yml); a
pull-request gate, in
[`examples/github-action-gate-pr.yml`](../examples/github-action-gate-pr.yml).

## What the human sees

The Central composes the line from the facts alone (A.6) — the command, the
branch, the commit, the repository. The `reason` the workflow passes is the
agent's own words, so it appears last, prefixed `AGENT SAYS`, on the detail
screen. The pager never reads a justification before it reads a fact.

```
310 bipeur DEPLOY flyctl deploy --ha=false -a bipeur-web #7c1d
```

## The verdict table: one path passes

The gate fails closed. There is exactly one answer that lets the job run, and
every other possibility — including the ones that feel like approvals — stops it.

| Answer of the Central | Job | Why |
|---|---|---|
| `approved` | **runs** | a human signed this page, on this device |
| `approved` + `simulated: true` | fails | shadow mode answered (BIP-F-42); nobody decided |
| `choice` with the declared letter | **runs** | the human picked the seeded option (`allow-choice`, default `A`) |
| `choice` with any other letter | fails | the human picked something else, and something else is not yes |
| `denied` | fails | a refusal, with the reason the human typed |
| `expired` | fails | a timeout is never an approval (BIP-F-29) |
| `cancelled` | fails | the page was withdrawn |
| `pending` at the deadline | fails | the job waited its `timeout-minutes` and nobody rang |
| unreachable Central, 4xx, 5xx, non-JSON | fails | no page, no signature, no deploy |

A network blip is retried three times, then the job fails: a gate that cannot
reach the pager is a gate that cannot prove a human said yes.

## The decision is bound to the commit

This is the part that makes a PR gate more than a checkbox.

The page fingerprint is the SHA-256 of its canonical facts
(`factsOf` in `packages/central/src/compose.ts`), and the commit is one of those
facts — it rides in `stats`, next to the branch and the command. The pager signs
that fingerprint; the Central verifies the signature against it before it stores
a decision (BIP-F-01). So an approval signed for `b4c3…` answers page `b4c3…` and
nothing else: push a new commit to the pull request and the head SHA changes, the
fingerprint changes, the idempotency key changes, and a **new page** rings.

`gate-pr` reads the **head** SHA from the event payload, not `GITHUB_SHA`. On a
`pull_request` event the runner checks out a throwaway merge commit that does not
exist on the branch and disappears on rebase; signing it would approve code nobody
reviewed. The test in `packages/gate-action/test/run.test.ts` computes the real
fingerprint of both pages and asserts they differ — it is not a claim in a
comment.

## Inputs

| Input | Required | Default | Meaning |
|---|---|---|---|
| `url` | yes | — | Base URL of the Central. A repository **variable**, not a secret. |
| `token` | yes | — | Station token. Always `secrets.…`, never a literal. |
| `command` | yes (`gate`) | — | What the job is about to run. The fact the human decides on. |
| `timeout-minutes` | no | `10` | How long the step waits. Past it, the job fails. |
| `ttl-minutes` | no | `timeout-minutes` | How long the page lives on the pager. |
| `station` | no | repository name | The page counts against this station's attention budget. |
| `tool` | no | `github-action` | Name of the tool doing the work, shown on the page. |
| `path`, `cwd`, `ref`, `stats` | no | workspace / `GITHUB_REF` / — | Extra facts, all fingerprinted. |
| `sha` | no | `GITHUB_SHA` (or the PR head, for `gate-pr`) | The commit the decision binds to. |
| `pr-number`, `ref` | no | event payload | Pull-request number and head branch, for `gate-pr`. The base branch is read from the event, and `stats` is composed (`sha … pr#N`). |
| `reason` | no | — | The agent's own words. Shown last, labelled `AGENT SAYS`. |
| `allow-choice` | no | `A` | Letter that means "run it" on a choice page. |
| `dedupe-key` | no | repo + run id + attempt + sha | Idempotency; a retried job never reuses an old page. |

Limits are the contract's (`packages/core/src/schema.ts`): a 4 000-character
command, a 160-character `stats`, a 32-character station, a page lifetime of
30 s to 24 h. Exceeding one fails the step with the name of the input — and never
its value.

## Outputs

`page_id`, `line`, `fingerprint`, `status`, `choice`, `simulated`, `latency_ms`,
`outcome`, `why`.

`page_id` is what closes the loop: a later step can post the evidence to
`POST /v1/closures` (BIP-F-41) and the pager that decided rings again with what
actually shipped. `latency_ms` is what the human spent, and it feeds the
attention cost of BIP-F-44.

## Secrets

The token is a station token: it can create pages and read verdicts, so it is
handled like a deploy credential.

* Pass it with `token: ${{ secrets.BIPEUR_STATION_TOKEN }}`. Never a literal in
  the YAML, never a value in `env:`.
* It is not printed. Every string the gate writes to the log goes through
  `redact()` with the secret list of the run, so a Central that echoes the
  credential back in a 401 body still shows `***` in the job log. Error messages
  name the input, never its value.
* One station per repository (per workflow, if you want the budget to mean
  something). Revoking it is one click on the dashboard, and the revocation is
  journalled (`device.revoked` / `source` revocation).
* `url` is not a secret, but it is not a literal either: a repository variable
  (`vars.BIPEUR_CENTRAL_URL`) keeps the environment movable.

## Running it locally

The action is a Node script, so it runs without a runner:

```bash
export INPUT_URL=http://127.0.0.1:8787
export INPUT_TOKEN=<the station token the Central printed at boot>
export INPUT_COMMAND='flyctl deploy --ha=false -a bipeur-web'
export GITHUB_SHA=$(git rev-parse HEAD) GITHUB_REF=refs/heads/main
node .github/actions/gate/index.js; echo "exit=$?"
```

`exit=0` means a human approved; `exit=1` means the job would not have run. The
unit tests cover the same path with a fake Central:

```bash
pnpm test -- packages/gate-action     # or: pnpm vitest run packages/gate-action
```

## How it is built

```
.github/actions/gate/action.yml      the manifest: inputs, outputs, node20
.github/actions/gate/index.js        three lines of glue
packages/gate-action/src/lib/*.js    the logic, plain ESM, zero dependencies
packages/gate-action/test/*.test.ts  vitest, run by the workspace config
```

A JavaScript action is executed straight from the repository checkout, in a
directory where **no `node_modules` exist** — so it cannot import `@bipeur/core`,
`zod` or `@actions/core`, and it cannot ship a bundle that would have to be
rebuilt and re-committed on every change. The logic therefore lives in
`packages/gate-action` as dependency-free ESM, next to the other adapters, and
the manifests in `.github/actions/` only import it. Like every adapter of this
repo (`packages/cli/src/api.ts`, `packages/hook/src/central-client.ts`,
`packages/mcp-server/src/client.ts`), it carries its own thin client of the three
endpoints it uses: `POST /v1/pages`, `GET /v1/pages/:id/decision?wait=N`,
`DELETE /v1/pages/:id`.

## Out of scope

* **No `dist/` bundle, no `ncc`, no version pinning per release.** Consumers pin
  a ref (`@main`, `@v1`) like any repository action.
* **No auto-approval, no "approve on timeout".** That is the one behaviour this
  feature exists to refuse.
* **No environment protection rules.** GitHub's own required-reviewers and
  protection rules still apply; the gate is a human page on top of them, not a
  replacement.
* **No artifact upload, no OIDC, no attestation.** A signed decision *is* the
  attestation; exporting it to SLSA provenance is a different feature.
* **One page per step.** The gate does not batch a job's several commands; that
  is grouped pages (BIP-F-47), and `group:` is already accepted by the contract.
