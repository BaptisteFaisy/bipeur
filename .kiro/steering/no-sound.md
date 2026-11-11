---
inclusion: always
---

# No sound — BIP-N-06

No agent, no test, no build step and no recipe in this repository triggers a
sound or changes the volume of a device.

- **No audio API.** No `Audio`, no `AudioContext`, no `HTMLAudioElement`, no
  `play()`, no `navigator.vibrate` outside the pager's own vibration setting,
  which is off by default.
- **The beep is a setting, off by default.** The pager's sound switch exists in
  the settings screen and starts disabled; a red page never depends on it.
- **Proof by logs, never by ear.** The intent to beep is the `beep.requested`
  event in the audit log. An acceptance item that would need a human to listen
  is rewritten as a log assertion.
- **CI has no sound card.** Any test that needed one would be flaky by design;
  the whole suite runs headless on self-hosted runners.
