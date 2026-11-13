# The agent demo — a real agent, stopped by a real human

The simulator plays three fictional agents. This page is the other demo: a
**real** coding agent, in a **real** repository, that cannot do an
irreversible thing without asking you first.

```bash
tools/demo/agent-demo.sh
```

One command, and the screen splits in two:

- **on the left**, a real `opencode` agent in a real git repository
  (`acme-api`, a small HTTP service) with a real staging remote to push to;
- **on the right**, your pager, on https://tradoooo.github.io/bipeur/app/.

The agent releases 1.2.0: it bumps the version, writes the changelog, commits…
and when it pushes, the **gate** opens a page and waits for you. You approve,
and the push happens; you refuse, and the agent has to live with the refusal
(it is told not to work around it, and it does not).

## The gate

The gate is the opencode plugin of `@bipeur/opencode-gate`. opencode calls it
before every tool call; the plugin classifies the command with **the rules of
the Central** — the same `.bipeur/rules.yaml` — and there are three answers:

| The rules say | What happens |
|---|---|
| `allow` | the command runs (`pnpm test`, `git status`, a `sed`…) |
| `deny` | refused outright, no page (`rm -rf /`, `curl … \| sh`) |
| `page` | a page opens on the pager, and the command waits for your answer |

The risk is computed from the command itself, never from what the agent says
about it. The question is opened by the `bip` CLI, so it is a real page: one
station, one page, one signed decision, one line in the audit log.

```bash
# the gate, on its own
bip ask "PUSH git push origin main" --yes-no --ttl 5m
```

## The keys

| Key | Effect |
|---|---|
| `a` `b` `c` `d` (or `1`…`4`) | answer A, B, C, D — the reply the terminal reads back as a code |
| `q` | hang up |

The pager is the web PWA (the app on the site) or the terminal emulator
(`bip-pager`, the unit side of RFC 1861). Both answer the same pages.

## Rehearsing without a thumb

A rehearsal helper answers for you: it pairs with the Central like a real
device (a real ECDSA key, a real device token) and signs a decision for every
page it receives.

```bash
# one code, valid five minutes, single use
curl -s -X POST https://r630-debian.tail3a8bdf.ts.net/v1/pairings \
  -H "Authorization: Bearer $BIPEUR_TOKEN" | jq -r .code

# answer every page for two minutes
node tools/demo/auto-approve.mjs ABC123 approved 120
node tools/demo/auto-approve.mjs ABC123 denied 120
```

With `denied`, the agent stops at the first refusal and the staging remote
keeps its first commit: the push never happened. That is the whole point.

## Why it is not a toy

- the agent is a real agent, with a real model, in a real repository;
- the gate is not a prompt: it is the tool-call boundary, so a model that
  forgets to ask still cannot push;
- the page is a real page, on the real Central, and your answer is a real
  signed decision — the same one the web PWA sends;
- the refusal path is exercised too: refuse once, and the release does not
  happen.
