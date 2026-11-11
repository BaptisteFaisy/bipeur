/** `bip --help`: one page, and the exit codes are part of the contract. */
export const HELP_TEXT = `bip — ask a human from a shell script (BIP-F-29)

Usage
  bip ask "Deploy now?" --yes-no --ttl 10m
  bip ask "Which date lib?" --choice A=dayjs,B=luxon,C=temporal --detail "no tz yet"
  bip notify "night build finished" --station crew

Options
  --yes-no               two replies: A Yes, B No
  --choice A=x,B=y       2 to 4 pre-seeded replies (codes A-D, label <= 20 chars)
  --detail "..."         second screen, 240 characters max
  --ttl 10m              lifetime, 30s to 1d (default 15m)
  --station <alias>      station alias, 6 characters or less
  --url <url>            Central URL (default $BIPEUR_URL, else http://127.0.0.1:8787)
  --token <token>        station token (default $BIPEUR_TOKEN)
  --json                 machine output only: {status, choice, page_id, latency_ms}
  --dry-run              compose the line locally, send nothing
  --notify "line"        log a notice in the journal of record, no page, no beep
  --help                 this page

Exit codes
  0  yes: approved, or a choice was made
  1  no: denied or cancelled
  3  expired: no decision before the deadline
  2  error: Central unreachable, missing token, invalid arguments
`;
