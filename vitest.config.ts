import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const r = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

/**
 * Single Vitest run for the whole workspace.
 * Two projects: `unit` (fast, always green in PR CI) and `props`
 * (fast-check property tests BIP-P-01 … BIP-P-12).
 */
export default defineConfig({
  resolve: {
    alias: {
      '@bipeur/core/node': r('./packages/core/src/node.ts'),
      '@bipeur/core': r('./packages/core/src/index.ts'),
      '@bipeur/central': r('./packages/central/src/index.ts'),
      '@bipeur/snpp': r('./packages/snpp/src/index.ts'),
      '@bipeur/hook': r('./packages/hook/src/index.ts'),
      '@bipeur/cli': r('./packages/cli/src/index.ts'),
      '@bipeur/mcp-server': r('./packages/mcp-server/src/index.ts'),
      '@bipeur/crew-app': r('./packages/crew-app/src/index.ts'),
    },
  },
  test: {
    // The suite opens real SQLite files and signs with WebCrypto; on a shared
    // machine the 5 s default timed out two tests that pass in 1 s alone. A
    // longer ceiling is not a weaker assertion — the waits themselves are
    // bounded and injected, nothing here sleeps to prove a timeout.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['packages/*/test/**/*.test.ts', 'packages/*/src/**/*.test.ts'],
          exclude: ['**/*.props.test.ts', 'packages/pager/**'],
        },
      },
      {
        extends: true,
        test: {
          name: 'props',
          environment: 'node',
          include: ['packages/*/test/**/*.props.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'pager',
          environment: 'happy-dom',
          include: ['packages/pager/test/**/*.test.tsx', 'packages/pager/test/**/*.test.ts'],
        },
      },
    ],
  },
});
