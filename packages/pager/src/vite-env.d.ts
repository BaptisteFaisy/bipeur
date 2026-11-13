/// <reference types="vite/client" />

/**
 * Vite injects `import.meta.env` (BASE_URL, MODE, DEV…) and the build-time
 * constants declared in `vite.config.ts` through `define`. This file is the
 * standard way to type them; without it `import.meta.env` is an error.
 */
interface ImportMetaEnv {
  readonly BASE_URL: string;
  readonly MODE: string;
  readonly DEV: boolean;
  readonly PROD: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
