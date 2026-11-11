---
name: pager-line
description: Write a page line that fits in 80 characters without losing the fact. Use whenever you compose a page, a notice, a digest line or a commit subject meant to be read on a pager.
---

# Writing a line that fits in 80 characters

The line is the product. `CODE STATION VERB subject #hhhh` — 80 printable ASCII
characters, 4 rows of 20 columns on the screen. If the fact does not survive the
cut, the page was not worth sending.

## Procedure

1. **Name the fact in one clause.** A fact is checkable: a command, a path, a
   branch, a count, a delta, a retry count. "Something went wrong" is not a fact.
2. **Pick the family, then the verb.** The code family decides the verb
   (`1xx`→`RUN`, `2xx`→`WRITE`/`DELETE`, `3xx`→`PUSH`/`MERGE`/`DEPLOY`,
   `4xx`→`CALL`/`SEND`, `5xx`→`PICK`, `6xx`→`SPEND`, `7xx`→`NEED`,
   `9xx`→`STUCK`). The verb is never invented.
3. **Write the subject in facts, most useful first.** Numbers before adjectives,
   the target before the intention: `main>origin 3 commits +120-14`.
4. **Count.** `head + 1 + subject + 1 + tag` must be ≤ 80. The tag (`#hhhh`) and
   the head are never truncated, so the subject gets `80 - head - 6`.
5. **Cut the middle, never the beginning.** Truncation inserts `~` and keeps the
   first word of the subject.
6. **Check.** `npx vitest run --project props -t "BIP-P-01"` proves the length
   and the tag; `-t "BIP-P-02"` proves that code, station, verb and first word
   survive.

## Good

```
310 a PUSH main>origin 3 commits +120-14 #07c2
610 fw SPEND 400 credits left of 1000, continue? #5b12
911 a STUCK cannot reach registry.npmjs.org (3 tries) #c44e
110 fw RUN rm -rf dist/ && pnpm build #a3f9
```

## Bad, and why

| Line | Why it fails |
|---|---|
| `310 a PUSH pushing some commits to main #07c2` | "some" is not a count; the branch is named but the delta is missing. |
| `911 a STUCK I tried several times and it seems the network is down, sorry` | 73 characters of narrative, no retry count, no host. |
| `110 fw RUN I will clean the build directory` | The agent's intention instead of the command. The line is composed from the payload. |
| `310 a PUSH main>origin 3 commits +120-14 and also the tag #07c2` | Over 80; and the tag must be the last five characters. |

## The honesty rule

The line and detail screens 2 and 3 are composed by the Central **from the
payload alone**. Your prose — what you meant, why, how hard you tried — goes to
screen 4, prefixed `AGENT SAYS:`. Never write a subject that summarises your
intent instead of the fact: the human decides on the fact.

## When it does not fit

- One idea per line; a second idea belongs to a detail screen (80 characters
  each, three max).
- Drop articles, then adjectives, then the least useful number — never the code,
  the station, the verb or the first word.
- If the fact genuinely needs two lines, it is two pages, not one long page.
