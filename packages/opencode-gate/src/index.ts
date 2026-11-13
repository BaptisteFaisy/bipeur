/**
 * `@bipeur/opencode-gate` — the opencode plugin that puts a human between the
 * agent and the irreversible.
 *
 * opencode loads the plugin file from `.opencode/plugin/`; the plugin itself
 * lives here. The decision is taken with the shared rules of the Central
 * (`.bipeur/rules.yaml`), and the question goes to the pager.
 */
export * from './gate.js';
export * from './ask.js';
export * from './plugin.js';
