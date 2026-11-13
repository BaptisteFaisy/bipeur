/**
 * Configuration (BIP-N-03, `.kiro/steering/rfc1861.md`): SNPP is plaintext, so
 * the gateway listens on the loopback and refuses any other interface unless
 * `LOGIn` credentials are configured. No socket is opened here: this is a test
 * of the configuration, not of the listener.
 */
import { describe, expect, it } from 'vitest';
import { ConfigError, isLoopbackHost, loadConfig, parseCredentials } from '../src/config.js';

const clean = (env: Record<string, string> = {}): NodeJS.ProcessEnv => ({ ...env });

describe('isLoopbackHost', () => {
  it.each(['127.0.0.1', '127.1.2.3', 'localhost', 'LOCALHOST', '::1', '[::1]', '::ffff:127.0.0.1'])(
    'accepts %s',
    (host) => {
      expect(isLoopbackHost(host)).toBe(true);
    },
  );

  it.each(['0.0.0.0', '192.168.1.10', '::', 'example.org', '10.0.0.1', ''])(
    'refuses %s',
    (host) => {
      expect(isLoopbackHost(host)).toBe(false);
    },
  );
});

describe('parseCredentials', () => {
  it('reads id:password, and accepts a colon inside the password', () => {
    expect(parseCredentials('admin:secret')).toEqual({ id: 'admin', password: 'secret' });
    expect(parseCredentials('admin:a:b')).toEqual({ id: 'admin', password: 'a:b' });
  });

  it('returns null when nothing is configured', () => {
    expect(parseCredentials(undefined)).toBeNull();
    expect(parseCredentials('   ')).toBeNull();
  });

  it.each(['admin', ':secret', 'admin:', 'nonsense'])('refuses %j', (raw) => {
    expect(() => parseCredentials(raw)).toThrow(ConfigError);
  });
});

describe('loadConfig — defaults and the LOGIn rule', () => {
  it('defaults to the loopback on 4440, with no login', () => {
    const config = loadConfig(clean());
    expect(config.host).toBe('127.0.0.1');
    expect(config.port).toBe(4440);
    expect(config.credentials).toBeNull();
    expect(config.centralUrl).toBe('http://127.0.0.1:8787');
  });

  it('refuses to listen off the loopback without LOGIn', () => {
    expect(() => loadConfig(clean({ BIPEUR_SNPP_HOST: '0.0.0.0' }))).toThrow(ConfigError);
    expect(() => loadConfig(clean({ BIPEUR_SNPP_HOST: '192.168.1.10' }))).toThrow(
      /not a loopback address/,
    );
  });

  it('accepts a public interface once LOGIn is configured', () => {
    const config = loadConfig(
      clean({ BIPEUR_SNPP_HOST: '0.0.0.0', BIPEUR_SNPP_LOGIN: 'admin:secret' }),
    );
    expect(config.host).toBe('0.0.0.0');
    expect(config.credentials).toEqual({ id: 'admin', password: 'secret' });
  });

  it('reads the port, and refuses anything that is not one', () => {
    expect(loadConfig(clean({ BIPEUR_SNPP_PORT: '4444' })).port).toBe(4444);
    expect(loadConfig(clean({ BIPEUR_SNPP_PORT: '0' })).port).toBe(0);
    expect(() => loadConfig(clean({ BIPEUR_SNPP_PORT: 'abc' }))).toThrow(ConfigError);
    expect(() => loadConfig(clean({ BIPEUR_SNPP_PORT: '70000' }))).toThrow(ConfigError);
  });

  it('reads the Central URL and the station token', () => {
    const config = loadConfig(
      clean({ BIPEUR_URL: 'http://central.local:8787/', BIPEUR_TOKEN: 'bip_test' }),
    );
    expect(config.centralUrl).toBe('http://central.local:8787');
    expect(config.token).toBe('bip_test');
  });

  it('takes the page lifetime from the shared default (15 minutes)', () => {
    expect(loadConfig(clean()).defaultTtlHours).toBeCloseTo(0.25, 6);
  });
});
