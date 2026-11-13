/**
 * English strings — the default UI language (BIP-N-08).
 * Every user-facing string of the pager lives here; the French dictionary must
 * implement exactly the same keys.
 */
export const en = {
  'app.name': 'Beeper',
  'nav.label': 'Screens',
  'nav.pager': 'Pager',
  'nav.memory': 'Memory',
  'nav.settings': 'Settings',
  'nav.pairing': 'Pair',
  'nav.demo': 'Demo',

  'status.connecting': 'Connecting',
  'status.online': 'Online',
  'status.offline': 'Offline',

  'pager.noPages': 'No pages. Your agents are fine.',
  'pager.emptyScreen': 'NO PAGES',
  'pager.queue': '{n} in queue',
  'pager.queueNone': 'Queue empty',
  'pager.detail': 'Detail {n} of {total}',
  'pager.detailLine': 'Page line',
  'pager.holdHint': 'Press and hold for one second',
  'pager.lockedDetail': 'Detail hidden while the screen is locked',
  'pager.screenLabel': 'Pager screen',
  'pager.readAloud': 'Read the line aloud',

  'risk.green': 'Green',
  'risk.amber': 'Amber',
  'risk.red': 'Red',
  'risk.green.hint': 'Local and reversible',
  'risk.amber.hint': 'Touches the outside world',
  'risk.red.hint': 'Irreversible or destructive',

  'key.approve': 'Approve',
  'key.deny': 'Refuse',
  'key.next': 'Next',
  'key.choose': 'Choose {code}',
  'keyboard.hint': 'Keys: Enter approves, Escape refuses, Down scrolls, A-D choose',

  'offline.banner': 'Offline — decisions stay on this device and are not sent.',

  'decision.queued': 'Queued, not sent. Retry when you are back online.',
  'decision.rejected': 'The Central refused this decision: {reason}',
  'decision.retry': 'Retry',
  'decision.sent': 'Sent',

  'memory.title': 'Memory — last 50 pages',
  'memory.empty': 'Nothing yet. Decisions you make land here.',
  'memory.verdict': 'Decision',
  'memory.latency': 'Delay',
  'memory.when': 'When',

  'verdict.approve': 'Approved',
  'verdict.deny': 'Refused',
  'verdict.choice': 'Chose {code}',

  'settings.title': 'Settings',
  'settings.sound': 'Sound',
  'settings.soundHint': 'Off at install. Turning it on only records a beep request in the audit log — the pager never plays a sound.',
  'settings.speech': 'Read aloud',
  'settings.speechHint': 'Off at install. Turning it on lets the read-aloud button pronounce the page line with speech synthesis.',
  'settings.vibration': 'Vibration',
  'settings.vibrationHint': 'Off at install. Used for a short pulse when a page arrives.',
  'settings.quietHours': 'Quiet hours',
  'settings.quietFrom': 'From',
  'settings.quietTo': 'To',
  'settings.budget': 'Pages per hour',
  'settings.hideDetail': 'Hide detail on the lock screen',
  'settings.hideDetailHint': 'Keeps screens 2 to 4 hidden until the pager is unlocked.',
  'settings.language': 'Language',
  'settings.device': 'Device',
  'settings.none': 'No device paired',
  'settings.revoke': 'Revoke this device',
  'settings.revoked': 'Device revoked. Pair again to keep receiving pages.',

  'pairing.title': 'Pair this pager',
  'pairing.code': 'Six-character code',
  'pairing.codeHint': 'Read it on the Central dashboard, or scan its QR code to land here.',
  'pairing.submit': 'Pair',
  'pairing.paired': '{n} device paired',
  'pairing.none': 'No device paired yet',
  'pairing.unsupported': 'This browser cannot create a non-extractable ECDSA P-256 key. Pairing is impossible here; use a recent Chrome, Edge, Firefox or Safari 16.4+.',
  'pairing.keyLost': 'A device is registered, but its private key only lives in memory and was lost when the page reloaded. Pair again.',
  'pairing.link': 'Pairing link',
  'pairing.qrNote': 'The QR code itself is displayed by the Central dashboard; this screen accepts the code it encodes.',
  'pairing.invalidCode': 'A pairing code is six letters or digits.',

  'demo.title': 'Demonstration',
  'demo.hint': 'Three fictional agents page you for two minutes. Nothing leaves this machine.',
  'demo.start': 'Start demo',
  'demo.open': 'Open pager',
  'demo.started': 'Demo running — pages are arriving.',

  'callback.label': 'Call back',
  'callback.hint': 'Open the session of the agent that sent this page.',

  'error.generic': 'Something went wrong.',
  'error.notPaired': 'Pair this pager before deciding.',
} as const;

export type MessageKey = keyof typeof en;
export type Dict = Record<MessageKey, string>;
