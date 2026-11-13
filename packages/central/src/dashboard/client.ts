/**
 * The dashboard client script, assembled from its two parts and wrapped in one
 * strict-mode IIFE: part 1 (state, API, polling) and part 2 (renderers) share
 * the same scope at runtime, while each source file stays small and readable.
 */
import { CLIENT_CORE } from './client-core.js';
import { CLIENT_RENDER } from './client-render.js';

export const DASHBOARD_JS = `(function () {
'use strict';
${CLIENT_CORE}
${CLIENT_RENDER}
}());
`;
