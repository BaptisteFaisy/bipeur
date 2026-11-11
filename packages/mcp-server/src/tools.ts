/**
 * BIP-F-26 — the three MCP tools. Descriptions matter as much as the code: a
 * model must understand that paging a human is expensive, and only justified
 * when it cannot go on alone (A.9).
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { BipeurService } from './service.js';

export const optionInputSchema = z.object({
  code: z.enum(['A', 'B', 'C', 'D']),
  label: z.string().min(1).max(20),
});

export const pageHumanInputSchema = z.object({
  question: z.string().min(1).max(80),
  options: z.array(optionInputSchema).min(2).max(4).optional(),
  detail: z.string().max(240).optional(),
  callback_url: z.string().max(2048).regex(/^https?:\/\//).optional(),
  ttl_seconds: z.number().int().min(30).max(86400).optional(),
});

export const pageWaitInputSchema = z.object({
  page_id: z.string().min(1).max(64),
  wait_seconds: z.number().int().min(1).max(600),
});

export const pageCancelInputSchema = z.object({
  page_id: z.string().min(1).max(64),
  reason: z.string().max(200).optional(),
});

const PAGE_HUMAN_DESCRIPTION = [
  'Ask the human operator for a decision through their pager.',
  'Use it only when you cannot proceed without a human choice: a permission you do not have,',
  'a destructive or irreversible action, a cost, or a design decision that changes the plan.',
  'Do not use it to report progress, to ask something you can find out yourself, or twice for',
  'the same question — a page already created is waited on with page_wait.',
  'The question must fit in 80 characters; 2 to 4 pre-seeded options (codes A to D) turn it',
  'into one tap. The answer comes back as approved, denied, choice, expired, or pending with',
  'a page id when the human has not answered within 50 seconds.',
].join(' ');

const PAGE_WAIT_DESCRIPTION = [
  'Keep waiting for the decision on a page you already created.',
  'Use it only with a page id that page_human returned as pending, and do not create a second',
  'page for the same question. Returns the same shape as page_human, and pending again when',
  'the human still has not answered.',
].join(' ');

const PAGE_CANCEL_DESCRIPTION = [
  'Cancel a page you created and no longer need, for instance because the action became',
  'irrelevant or you found the answer yourself. Returns {"cancelled": true}.',
].join(' ');

export function registerTools(server: McpServer, service: BipeurService): void {
  server.registerTool(
    'page_human',
    {
      title: 'Ask a human through their pager',
      description: PAGE_HUMAN_DESCRIPTION,
      inputSchema: pageHumanInputSchema.shape,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async (input) => asToolResult(() => service.pageHuman(input)),
  );

  server.registerTool(
    'page_wait',
    {
      title: 'Wait again for a pending page',
      description: PAGE_WAIT_DESCRIPTION,
      inputSchema: pageWaitInputSchema.shape,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async (input) => asToolResult(() => service.pageWait(input)),
  );

  server.registerTool(
    'page_cancel',
    {
      title: 'Cancel a page',
      description: PAGE_CANCEL_DESCRIPTION,
      inputSchema: pageCancelInputSchema.shape,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (input) => asToolResult(() => service.pageCancel(input)),
  );
}

/** A tool never throws: an error becomes an MCP tool error, not a dead server. */
async function asToolResult(run: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    const value = await run();
    return { content: [{ type: 'text', text: JSON.stringify(value) }] };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown error';
    return { isError: true, content: [{ type: 'text', text: `bipeur: ${reason}` }] };
  }
}
