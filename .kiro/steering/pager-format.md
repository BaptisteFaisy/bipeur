---
inclusion: always
---

# Pager format — the 80 characters that make the product

## Capacity

80 characters, displayed on **4 rows of 20 columns**, printable ASCII only.
Accents are transliterated (`déploiement` → `deploiement`, `—` → `-`).
This is the capacity of a common alphanumeric pager screen, and it is a hard
constraint, not a guideline.

## Structure

```
CODE STATION VERB subject #hhhh
```

| Field | Rule |
|---|---|
| `CODE` | three digits, never truncated |
| `STATION` | alias of the source, **6 characters max**, never truncated |
| `VERB` | capitals, closed list, never truncated |
| `subject` | the rest; truncated in the middle with `~`, first word never cut |
| `#hhhh` | first four hex characters of the payload fingerprint; the last five characters of the line are reserved for it |

Verbs: `RUN`, `WRITE`, `DELETE`, `PUSH`, `MERGE`, `DEPLOY`, `CALL`, `SEND`,
`PICK`, `SPEND`, `NEED`, `STUCK`. A verb that does not belong to the family of
the code is replaced by the family default.

## Code families

| Code | Family | Verbs | Default risk |
|---|---|---|---|
| 1xx | terminal command | RUN | amber |
| 2xx | files out of the agreed scope | WRITE, DELETE | amber |
| 3xx | git and deployment | PUSH, MERGE, DEPLOY | amber |
| 4xx | external service (MCP tool, send) | CALL, SEND | amber |
| 5xx | design choice | PICK | green |
| 6xx | budget (credits, duration) | SPEND | amber |
| 7xx | missing access (secret, permission) | NEED | amber |
| 9xx | stuck agent or incident, `911` = emergency | STUCK | red |

## Risk levels

| Level | Criterion | Gesture |
|---|---|---|
| green | local and reversible | one tap, possible from the notification |
| amber | touches the outside or a wide scope | one tap in the open pager |
| red | irreversible or destructive | pager open **and** one second press-and-hold |

The level is computed by rules. A source may raise it, never lower it. Red and
family 9 bypass the attention budget and quiet hours.

## Detail screens

The ▼ key scrolls through at most **three** extra screens of 80 characters:

1. screen 2 — the full command or path;
2. screen 3 — working directory and branch;
3. screen 4 — the agent's own reason, prefixed with `AGENT SAYS:`.

## The honesty rule

For a tool approval, the line and screens 2 and 3 are composed by the Central
**from the payload alone** (command, path, cwd, branch, diff stats). The agent's
free text appears only on screen 4, labelled. The human decides on the fact, not
on the story. Any feature that lets an agent influence screens 1 to 3 is a bug.

## Examples (all under 80 characters)

```
110 fw RUN rm -rf dist/ && pnpm build #a3f9
310 a PUSH main>origin 3 commits +120-14 #07c2
510 b PICK date lib? A dayjs B luxon C temporal #e1d0
610 fw SPEND 400 credits left of 1000, continue? #5b12
911 a STUCK cannot reach registry.npmjs.org (3 tries) #c44e
```

## Writing a subject

- Facts before adjectives: `main>origin 3 commits +120-14`, not "pushing some commits".
- Numbers are worth more than words: counts, sizes, deltas, retries.
- One idea per line. If a second idea is needed, it belongs to a detail screen.
- No markup, no emoji, no URL other than the declared callback address.
- If it does not fit, cut the middle, never the beginning.
