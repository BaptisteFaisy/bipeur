---
inclusion: always
---

# Product — Beeper

**One line.** Beeper is the attention protocol between coding agents and the
human on call. Agents page the human only when a decision is required; the human
approves or refuses from a pager, in two gestures, without opening a terminal.

## Who it is for

- **Léa**, freelance developer: runs three to six agents on two repositories and
  wants dinner without a terminal. She has her phone, not her shell.
- **Marc**, tech lead of four: delegates night work to agents and wants a log of
  who approved what.
- **A Crew operator on continuous duty**: sessions ask for approvals at all
  hours; he wants a ceiling and quiet hours.

## The three failures Beeper answers

1. **Invisible waiting** — an agent blocked on a confirmation costs nothing in
   credits and everything in time.
2. **Blind trust** — to avoid waiting, every tool is granted; the guardrail
   disappears exactly when nobody is watching.
3. **Noise** — every tool has its channel and writes paragraphs; past a few
   notifications an hour, nobody reads them.

## Goals

- **O1** An agent that needs a human gets one in under a minute during active hours.
- **O2** The human receives at most six pages an hour by default, whatever the number of agents.
- **O3** A decision takes two gestures at most, without opening a terminal.
- **O4** An approval can never apply to another action than the one displayed.
- **O5** Kiro IDE, Kiro CLI, Kiro Crew and any MCP client plug in without changing the agent.

## Non-goals

Not an orchestrator, not a chat, not a replacement for Kiro's permission system,
not a radio (no POCSAG, no hardware), not a shared multi-tenant service.

## The idea that must survive every decision

The constraints of a pager — one line, one code, pre-seeded replies, a read
acknowledgement — are the *right* attention protocol. Whenever a feature makes a
page longer, vaguer or more frequent, it is wrong, however useful it looks.

## The honesty rule (non-negotiable)

For a tool approval, the line and detail screens 2 and 3 are composed by the
Central **from the payload alone**. The agent's free text appears only on screen
4, prefixed with `AGENT SAYS:`. The human decides on the fact, never on the
narrative.

## Metrics (all derived from the audit log)

| Metric | Target |
|---|---|
| Decision latency (median, active hours) | < 60 s |
| Filter rate (agent events that never page) | ≥ 90 % |
| Orphan approvals | 0, by construction |
| Delivery latency (p95, local network) | < 2 s |
| Unblocked time | displayed, no target |
