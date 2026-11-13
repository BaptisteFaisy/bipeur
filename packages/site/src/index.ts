/** Public surface of @bipeur/site: the assembler and its renderers. */
export { buildSite } from './build.js';
export { dashboardUrl, readEnvConfig, type Env, type SiteConfig } from './config.js';
export {
  collectDocs,
  markdownToHtml,
  renderDocPage,
  renderDocsIndex,
  slugOf,
  titleOf,
  type DocEntry,
} from './docs.js';
export { escapeHtml, renderPage, type PageOptions } from './html.js';
export { renderLanding } from './landing.js';
export { siteCss } from './style.js';
