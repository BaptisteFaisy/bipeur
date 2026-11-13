# Demo script — 3 minutes, four beats

Recorded in one take, screen and phone, no music (a soundtrack is a licence to
verify and a distraction from the point). Subtitles in English.

Total 3:00. The clock in the left column is what the final cut must show.

## Beat 1 — 0:00 → 0:50 · the situation, then one line

| Time | On screen | Voice |
|---|---|---|
| 0:00 | Three terminals in the dark. The first one ends with `waiting since 19:12`. | "Tuesday, 11 pm. I started three agents before dinner. One has been waiting since 19:12 for a `git push` confirmation nobody saw." |
| 0:10 | The second terminal scrolls a folder being rewritten. The third is idle, finished, silent. | "The second ran in full-trust mode and rewrote a folder it should not have touched. The third finished three hours ago and nobody knows." |
| 0:20 | Cut to the phone: scan the QR code, the pager installs on the home screen. | "Three failures: invisible waiting, blind trust, noise. A pager answers all three, and it answered them in 1995." |
| 0:30 | An agent runs `git push origin main`. The hook blocks. The pager lights: `310 a PUSH main>origin 3 commits +120-14 #07c2`. | "The agent asks. The line is composed by the server from the command itself — the agent's own words are on screen four, labelled." |
| 0:40 | Thumb taps ✔. The terminal resumes within a second. | "One line, one code, one tap. The terminal resumes." |

## Beat 2 — 0:50 → 1:40 · red, then the ceiling

| Time | On screen | Voice |
|---|---|---|
| 0:50 | An agent proposes `rm -rf packages/`. Red lamp, square shape, no button in the notification. | "Red. Irreversible. The notification deliberately offers no button." |
| 1:00 | Open the pager, press ▼ twice (screens 2 and 3: the full command, the cwd and branch), hold ✖ for one second. | "The detail screens come from the payload. The refusal is a one-second hold — and it carries a reason." |
| 1:10 | Terminal: the agent reads the reason and proposes a safer command. | "The agent gets the refusal with its reason and changes course. That is what a decision is for." |
| 1:20 | Dashboard: `47 events · 4 pages`. Quiet hours panel. Digest lines. | "Forty-seven events, four pages. A budget of six per hour, quiet hours, and everything else goes to a digest — one line per station." |
| 1:32 | Seven green requests fired in a loop; six deliveries, one held, then a grouped delivery. | "Seven requests: six delivered, one held, then delivered together when a slot frees. Red would have passed anyway." |

## Beat 3 — 1:40 → 2:10 · 1995 on the wire

| Time | On screen | Voice |
|---|---|---|
| 1:40 | Two windows: `nc 127.0.0.1 4440` on the left, `bip-pager --capcode lea` on the right — a real pager of 1995, in a terminal. Type `2WAY`, `PAGE lea`, `MESS`, `RTYP MULTICHOICE`, `MCRE`, `SEND`. | "This protocol is from 1995. It already had multiple-choice replies seeded by the sender, a read acknowledgement and an expiry." |
| 1:55 | The pager lights up from the raw TCP session: the 4 × 20 LCD shows the line, the keys A and B appear. Press `a`. Type `MSTA 4821 7730`. | "`861` delivered, `888` reply received with its code. No chat, no paragraph: a code." |
| 2:05 | `KTAG`, `QUIT`, `421` closing. | "Simple Network Paging Protocol, level 3. RFC 1861." |

Follow `docs/SNPP.md` for the exact keystrokes.

## Beat 3b — the same pager, with a real agent

| Time | On screen | Voice |
|---|---|---|
| 2:10 | `tools/demo/agent-demo.sh`: a real opencode agent in a real repository. It bumps the version, commits, and reaches for `git push`. | "Same pager. This time the caller is an agent that cannot push without you." |
| 2:20 | The pager rings: `310 oc PUSH git push origin main`. Press ✔. | "The gate is the tool-call boundary, not a prompt: the model cannot forget to ask." |
| 2:30 | The push lands in the staging remote; the agent reports the release. | "One line, one code, one tap. The agent waited." |

Follow [`docs/AGENT-DEMO.md`](AGENT-DEMO.md) — and refuse once, to show what
happens when the human says no.

## Beat 4 — 2:10 → 3:00 · how Kiro built it, and the numbers

| Time | On screen | Voice |
|---|---|---|
| 2:10 | `.kiro/specs/central-core/requirements.md` → `tasks.md`, then a property test failing. | "Six specs, one per lot, written in EARS before the code. This property test found a counter-example on the first run: a `curl … \| sh` hidden in a pipeline looked harmless." |
| 2:25 | `.kiro/hooks/bipeur-approve.json`, then the pager receiving a page **from this repository's own build**. | "And from lot four, the repository is supervised by its own product: the hook in this file pages me when an agent wants to push." |
| 2:40 | Audit log filtered on `decision.*`: median latency, filter rate, zero orphan approvals. | "Median decision latency: [n] seconds. Filter rate: [n] percent. Orphan approvals: zero — not because we tested for it, but because the decision is signed over the fingerprint." |
| 2:52 | Title card: Beeper, the URL, "One line. One code. One tap." | "The pager is back. It is supervising my agents." |

Fill the bracketed numbers from the audit log of the real session; never round
up, and never quote a number the log cannot reproduce.

## Instructions for the judges

1. Open the demo URL from the Devpost page (no account, no installation).
2. Click **Start demo**. A space is created for you and wiped after 24 hours.
3. Click **Open pager** in a second tab — or scan the QR code with a phone.
4. Watch the simulator play three fictional stations: a `git push`, a destructive
   `rm -rf`, a design question, a budget warning, a stuck agent.
5. Approve the push (one tap). Refuse the destructive command (open the pager,
   ▼ twice, hold ✖ for one second).
6. Optional, if you have a shell: `nc <demo-host> 4440` is **not** exposed by
   design — use the recorded video for the SNPP beat, or run the repository
   locally (`pnpm install && pnpm build && pnpm central`).
7. The dashboard at `/dashboard` shows the indicators, all computed from the
   audit log. The rules bench at `/rules` shows what a pasted command would
   produce, without creating a page.

Nothing in the demo requires an account, an API key, a model call or a sound.
