/**
 * Mounting of the dashboard UI (BIP-F-30 to F-32): three static responses
 * served by the Central itself on /dashboard — never on /, which keeps serving
 * the pager (the judges' URL). Plain HTML/CSS/JS, no framework, no build step.
 */
import type { Hono } from 'hono';
import { DASHBOARD_JS } from './client.js';
import { DASHBOARD_HTML } from './html.js';
import { DASHBOARD_CSS } from './styles.js';

function textResponse(body: string, contentType: string): Response {
  return new Response(body, {
    headers: { 'content-type': contentType, 'cache-control': 'no-store' },
  });
}

export function registerDashboardUi(app: Hono): void {
  app.get('/dashboard', () => textResponse(DASHBOARD_HTML, 'text/html; charset=utf-8'));
  app.get('/dashboard/app.css', () => textResponse(DASHBOARD_CSS, 'text/css; charset=utf-8'));
  app.get('/dashboard/app.js', () => textResponse(DASHBOARD_JS, 'text/javascript; charset=utf-8'));
}
