/** The docs renderer: fixtures in a temp dir, HTML out. No network. */
import { beforeAll, describe, expect, it } from 'vitest';
import {
  collectDocs,
  markdownToHtml,
  renderDocPage,
  renderDocsIndex,
  slugOf,
  titleOf,
} from '../src/docs.js';
import { makeDocsDir, makeTmpDir } from './support/fixtures.js';

let docsDir: string;

beforeAll(() => {
  docsDir = makeDocsDir(makeTmpDir('docs'));
});

describe('collectDocs', () => {
  it('reads every .md, lowercases the slug, ignores the rest', () => {
    const docs = collectDocs(docsDir);
    expect(docs.map((entry) => entry.slug)).toEqual(['guide', 'notes']);
    expect(slugOf('ART-DIRECTION.md')).toBe('art-direction');
  });

  it('takes the title from the first heading, or falls back to the slug', () => {
    const docs = collectDocs(docsDir);
    expect(docs[0]?.title).toBe('User guide');
    expect(docs[1]?.title).toBe('notes');
    expect(titleOf('# Real title\n\ntext', 'fallback')).toBe('Real title');
    expect(titleOf('no heading here', 'fallback')).toBe('fallback');
  });
});

describe('markdownToHtml', () => {
  it('renders markdown', () => {
    expect(markdownToHtml('Hello **world**')).toContain('<strong>world</strong>');
  });
});

describe('renderDocPage', () => {
  it('wraps the content in the common template: home, nav, article', () => {
    const docs = collectDocs(docsDir);
    const page = renderDocPage(docs[0]!, docs);
    expect(page).toContain('<title>User guide — Beeper</title>');
    expect(page).toContain('href="../"');
    expect(page).toContain('&larr; Home');
    expect(page).toContain('href="guide.html" aria-current="page"');
    expect(page).toContain('href="notes.html"');
    expect(page).toContain('<strong>everything</strong>');
    expect(page).toContain('href="../site.css"');
    expect(page).not.toContain('<script');
  });
});

describe('renderDocsIndex', () => {
  it('lists every document', () => {
    const docs = collectDocs(docsDir);
    const index = renderDocsIndex(docs);
    expect(index).toContain('<title>Documentation — Beeper</title>');
    expect(index).toContain('href="guide.html"');
    expect(index).toContain('href="notes.html"');
    expect(index).toContain('User guide');
    expect(index).not.toContain('<script');
  });
});
