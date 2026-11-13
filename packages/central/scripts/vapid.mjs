#!/usr/bin/env node
/**
 * Generate a VAPID key pair for Web Push (BIP-F-19).
 *
 *   pnpm --filter @bipeur/central exec node scripts/vapid.mjs
 *
 * Prints the three variables to paste into `.env` or into the systemd unit.
 * The private key is printed once and stored nowhere: this script writes no
 * file, so nothing can be committed by accident. The public key is published by
 * the Central on `/v1/push-config` — that is its purpose, it is not a secret.
 */
import { generateVAPIDKeys } from 'web-push';

const keys = generateVAPIDKeys();
const subject = process.env.BIPEUR_VAPID_SUBJECT || 'mailto:beeper@localhost';

process.stdout.write(
  [
    '# VAPID keys for Web Push (BIP-F-19). The private key is a secret:',
    '# it belongs in the environment of the Central, never in the repository.',
    `BIPEUR_VAPID_PUBLIC_KEY=${keys.publicKey}`,
    `BIPEUR_VAPID_PRIVATE_KEY=${keys.privateKey}`,
    `BIPEUR_VAPID_SUBJECT=${subject}`,
    '',
  ].join('\n'),
);
