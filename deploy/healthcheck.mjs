/**
 * Container liveness probe: GET /healthz must answer 200 (BIP-N-09).
 * Used by the Dockerfile HEALTHCHECK; nothing beyond Node itself is needed.
 */
const host = process.env.BIPEUR_HEALTHZ_HOST ?? '127.0.0.1';
const port = process.env.BIPEUR_PORT ?? '8787';

try {
  const response = await fetch(`http://${host}:${port}/healthz`);
  process.exitCode = response.ok ? 0 : 1;
} catch {
  process.exitCode = 1;
}
