/**
 * Who is calling, for rate-limiting purposes.
 *
 * The previous versions keyed the limiter on `X-Forwarded-For`. That header
 * belongs to the client: anyone can send a different value per request and get a
 * fresh bucket each time, which turns a limit into a suggestion. Measured on a
 * directly exposed instance — 60 demo spaces in a minute against a limit of 20,
 * and 40 pairing attempts with no single 429, so the six-character pairing code
 * was open to brute force.
 *
 * The default is therefore the socket's peer address, which the caller cannot
 * forge. `X-Forwarded-For` is honoured only when the operator says there is a
 * trusted proxy in front (`BIPEUR_TRUST_PROXY=1`) — behind Tailscale Funnel,
 * nginx or Caddy, the edge rewrites the header, and trusting it is correct.
 *
 * Note this is an abuse brake, not an identity: NAT means several humans can
 * share one address. Nothing here authorises anything; tokens still do.
 */
import type { Context } from 'hono';

interface NodeEnv {
  incoming?: { socket?: { remoteAddress?: string } };
}

/** The peer address as the kernel sees it, or `local` when unavailable. */
export function peerAddress(c: Context): string {
  const env = c.env as NodeEnv | undefined;
  const address = env?.incoming?.socket?.remoteAddress;
  if (!address) return 'local';
  // An IPv4-mapped IPv6 address is the same client as the IPv4 one.
  return address.startsWith('::ffff:') ? address.slice(7) : address;
}

/**
 * The client address out of `X-Forwarded-For` — taken from the **right**, not
 * the left.
 *
 * A trusted proxy *appends* the peer it saw, so the right-most entry is the one
 * the proxy itself vouches for and the left-most is whatever the caller wrote.
 * Reading the first hop would hand the limiter straight back to the attacker:
 * `X-Forwarded-For: 1.2.3.4` from behind Funnel arrives as
 * `1.2.3.4, <real client>`, and the forged value would mint a fresh bucket per
 * request — the exact defect this module exists to close.
 *
 * With several stacked proxies the operator should count back one hop per
 * trusted proxy; one edge (Funnel, nginx, Caddy) is the common case and the
 * right-most entry is then the real client.
 */
export function forwardedAddress(c: Context): string | null {
  const header = c.req.header('x-forwarded-for');
  if (!header) return null;
  const hops = header.split(',').map((hop) => hop.trim()).filter((hop) => hop.length > 0);
  return hops.length > 0 ? hops[hops.length - 1]! : null;
}

export function clientKey(c: Context, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = forwardedAddress(c);
    if (forwarded) return forwarded;
  }
  return peerAddress(c);
}
