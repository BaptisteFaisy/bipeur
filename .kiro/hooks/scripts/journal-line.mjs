#!/usr/bin/env node
/* global console, process */
/**
 * journal-reminder's action: append one dated line to KIRO_JOURNAL.md when a
 * spec task ends. The form asks what Kiro changed lot by lot; a journal written
 * at the end is a reconstruction, a journal appended by a hook is a record.
 *
 * The label comes from KIRO_TASK, or from the hook event on stdin
 * (`task_name`, `spec`, `task`), or falls back to "unnamed task" — never a
 * blank row. Running twice for the same label on the same day is a no-op.
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const JOURNAL = join(ROOT, 'KIRO_JOURNAL.md');
const HEADING = '## Spec task log';

function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function labelFrom(event, env) {
  if (env.KIRO_TASK) return env.KIRO_TASK;
  try {
    const parsed = JSON.parse(event);
    return parsed.task_name ?? parsed.spec ?? parsed.task ?? 'unnamed task';
  } catch {
    return 'unnamed task';
  }
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function withSection(text) {
  if (text.includes(HEADING)) return text;
  const separator = text.endsWith('\n') ? '\n' : '\n\n';
  return `${text}${separator}${HEADING}\n\nAppended by \`.kiro/hooks/journal-reminder.json\` at the end of each spec task.\n`;
}

function main() {
  if (!existsSync(JOURNAL)) {
    console.error('journal-reminder: KIRO_JOURNAL.md is missing');
    process.exit(1);
  }
  const label = labelFrom(readStdin(), process.env).replace(/\s+/g, ' ').trim();
  const line = `- ${today()} — ${label}`;
  const original = readFileSync(JOURNAL, 'utf8');
  if (original.includes(line)) {
    console.log(`journal-reminder: already recorded (${label})`);
    return;
  }
  const text = withSection(original);
  const added = text.slice(original.length);
  const lead = added.length > 0 || !text.endsWith('\n') ? '\n' : '';
  appendFileSync(JOURNAL, `${added}${lead}${line}\n`);
  console.log(`journal-reminder: recorded ${line}`);
}

main();
