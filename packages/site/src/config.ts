/**
 * What the site is built from: two values come from the deployment (the Pages
 * prefix and the Central the pager talks to), the three others are paths with
 * a repository-root default, so `node packages/site/dist/build.js` alone does
 * the right thing.
 */
export interface SiteConfig {
  /** Pages prefix, always with a trailing slash: `/bipeur/`. */
  siteBase: string;
  /** The Central behind the dashboard link; `''` means same origin. */
  centralUrl: string;
  /** The vite build of the pager, copied verbatim under `app/`. */
  pagerDist: string;
  /** Markdown sources rendered under `docs/`. */
  docsDir: string;
  /** The assembled tree — one Pages artifact. */
  outDir: string;
}

export type Env = Readonly<Record<string, string | undefined>>;

function withTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}

export function readEnvConfig(env: Env = process.env): SiteConfig {
  return {
    siteBase: withTrailingSlash(env.SITE_BASE ?? '/'),
    centralUrl: (env.CENTRAL_URL ?? '').trim().replace(/\/+$/, ''),
    pagerDist: env.PAGER_DIST ?? 'packages/pager/dist',
    docsDir: env.DOCS_DIR ?? 'docs',
    outDir: env.OUT_DIR ?? 'site-dist',
  };
}

/**
 * Where the dashboard lives: the Central's address when it is a usable http(s)
 * URL — anything else (a `javascript:` value, garbage) falls back to the same
 * origin, the Central serving the site itself.
 */
export function dashboardUrl(config: SiteConfig): string {
  const base = /^https?:\/\//i.test(config.centralUrl) ? config.centralUrl : '';
  return `${base}/dashboard`;
}
