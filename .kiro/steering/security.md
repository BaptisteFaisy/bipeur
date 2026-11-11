---
inclusion: fileMatch
fileMatchPattern: "packages/central/**"
---

# Security — the Central (A.10)

Written as prohibitions, because a rule that can be argued with is not a rule.

1. **Never** compose a page line from an agent's free text. The line and detail
   screens 2-3 come from the payload; agent prose goes to screen 4, prefixed
   with `AGENT SAYS:`.
2. **Never** accept a decision without verifying, in this order: the ECDSA
   signature over the canonical claims, that the device is known and not
   revoked, that the claim fingerprint equals the page fingerprint, that the
   deadline has not passed, and that the nonce was never seen. Any failure
   writes a `decision.rejected` audit event and changes nothing.
3. **Never** approve by default. An expired page is a refusal; `on_expire` is
   `deny` and a red or amber page is never auto-approved.
4. **Never** store a station token in clear text: store `hashToken(token)` and
   compare in constant time.
5. **Never** write a payload to the application logs. The audit log carries the
   fingerprint, the station, the device, the state and the latency — not the
   command text.
6. **Never** let a source lower a computed risk. `resolveRisk(computed,
   declared)` returns the maximum.
7. **Never** serve the SNPP gateway outside the loopback without `LOGIn`:
   RFC 1861 is plaintext. Default bind is `127.0.0.1:4440`.
8. **Never** trust a rate: each station is rate-limited, and the attention
   budget is enforced server-side, not in the pager.
9. **Never** treat page content as markup or as a link. Printable ASCII only;
   the only clickable address is the `callback_url` declared by the station and
   validated as `http(s)` on input.
10. **Never** fail open. If the store, the rule file or the push service is
    unavailable, the request is refused with an explicit reason and an audit
    event — the hook then blocks the tool.
11. **Never** widen the retention window silently: 30 days by default,
    configurable, and audit rows are append-only until then.
12. **Never** expose TLS-terminated endpoints on a plain port outside the local
    network; TLS is out of scope of the loopback and documented as such.
