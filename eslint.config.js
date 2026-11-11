import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      'packages/pager/dev-dist/**',
      'e2e/playwright-report/**',
      'e2e/test-results/**',
      'dev-server/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      eqeqeq: ['error', 'smart'],
      'no-console': 'off',
    },
  },
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/*.props.test.ts', 'e2e/**'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
