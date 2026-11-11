/**
 * Beeper dashboard page for the Kiro Crew host.
 *
 * This module is the `ui.pages[].entryPoint` of app.json: the Crew dashboard
 * loads it as an ESM bundle and calls the exported `mount(el)`. The bare
 * specifiers below (`react`, `react-dom/client`, `@kirocrew/app-sdk`,
 * `@kirocrew/app-sdk/ui`) are NOT npm dependencies — the host resolves them
 * at runtime through its import map (`window.__kirocrew_modules`), which is
 * why this file ships as plain source with no build step and no bundler.
 *
 * Read-only by design: a decision must be signed by the paired pager, so
 * this page shows the approvals the relay is carrying and never resolves one.
 * No sound (BIP-N-06); colors come from the host theme (`useTheme`).
 */
import { createElement as h, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useAppEvents, useAppInfo, useTheme } from '@kirocrew/app-sdk';
import { Badge, Card, CardTitle, EmptyState, PageHeader } from '@kirocrew/app-sdk/ui';

const MAX_ROWS = 12;

function approvalRow(a) {
  const tool = a.tool ?? 'tool';
  const purpose = a.tool_purpose ?? a.tool_input ?? '';
  return h(
    'div',
    {
      key: `${a.id}:${a.instance ?? ''}`,
      style: {
        display: 'flex',
        gap: '0.5rem',
        alignItems: 'baseline',
        padding: '0.35rem 0',
        borderBottom: '1px solid color-mix(in srgb, currentColor 12%, transparent)',
      },
    },
    h(Badge, null, tool),
    h('span', { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, purpose),
    h('span', { style: { opacity: 0.6, fontSize: '0.8em' } }, a.slot ?? ''),
  );
}

function pendingCard(pending) {
  return h(
    Card,
    null,
    h(CardTitle, null, `On the pager line (${pending.length})`),
    pending.length === 0
      ? h(EmptyState, { title: 'Line idle', description: 'No approval is waiting on a human right now.' })
      : pending.map(approvalRow),
  );
}

function explainCard() {
  return h(
    Card,
    null,
    h(CardTitle, null, 'How a decision comes back'),
    h(
      'p',
      { style: { fontSize: '0.9rem', lineHeight: 1.5 } },
      'Each approval below beeps the paired pager station. The human answers on the pager; the signed decision resolves the approval here exactly once. A denial carries the typed reason back to the agent. This page never resolves an approval itself.',
    ),
  );
}

function BeeperPage() {
  const theme = useTheme();
  const info = useAppInfo();
  const [pending, setPending] = useState([]);

  useAppEvents('approval', useCallback((frame) => {
    const data = frame?.data ?? frame ?? {};
    if (typeof data.id !== 'string' || data.id.length === 0) return;
    setPending((rows) => {
      const key = `${data.id}:${data.instance ?? ''}`;
      const next = rows.filter((r) => `${r.id}:${r.instance ?? ''}` !== key);
      return [data, ...next].slice(0, MAX_ROWS);
    });
  }, []));

  useAppEvents('approval_resolved', useCallback((frame) => {
    const data = frame?.data ?? frame ?? {};
    setPending((rows) => rows.filter((r) => r.id !== data.id));
  }, []));

  useEffect(() => {
    document.documentElement.dataset.theme = theme?.mode ?? 'light';
  }, [theme?.mode]);

  return h(
    'div',
    { style: { display: 'flex', flexDirection: 'column', minHeight: '100%' } },
    h(PageHeader, {
      title: 'Beeper',
      subtitle: `Pending Crew approvals carried to the pager — v${info?.version ?? '?'}`,
    }),
    h(
      'div',
      { style: { padding: '0 1.5rem 2rem', display: 'grid', gap: '0.9rem' } },
      pendingCard(pending),
      explainCard(),
    ),
  );
}

/** Host contract: `ui.pages[].mountFunction` — render into the given element. */
export function mount(el) {
  const root = createRoot(el);
  root.render(h(BeeperPage));
  return () => root.unmount();
}

export default BeeperPage;
