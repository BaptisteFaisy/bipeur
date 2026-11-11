/**
 * In-memory double of the Central, used by the gateway tests: no HTTP, no
 * network, no real pager (`.kiro/steering/testing.md` §4).
 *
 * A page is created at once; its decision resolves when the test says so,
 * which makes the replayed transcript deterministic.
 */
import type { BeeperClient, CreatedPage, Decision, PageDraft } from '../src/client.js';

export interface FakeCentralOptions {
  online?: boolean;
  /** Page state reported by `getPageState`, e.g. `read` once the pager shows it. */
  state?: string | null;
  withState?: boolean;
}

export class FakeCentral implements BeeperClient {
  readonly drafts: PageDraft[] = [];
  readonly waits: { pageId: string; waitSeconds: number }[] = [];
  online: boolean;
  state: string | null;
  private readonly withState: boolean;
  private next = 0;
  private resolveDecision: ((decision: Decision) => void) | null = null;

  constructor(options: FakeCentralOptions = {}) {
    this.online = options.online ?? true;
    // A pager that acknowledged the read: the gateway sees `read` on the page.
    this.state = options.state ?? 'read';
    this.withState = options.withState ?? true;
  }

  createPage(draft: PageDraft): Promise<CreatedPage> {
    this.drafts.push(draft);
    this.next += 1;
    return Promise.resolve({
      pageId: `page_${this.next}`,
      fingerprint: 'a'.repeat(64),
      line: draft.message.slice(0, 80),
    });
  }

  waitDecision(pageId: string, waitSeconds: number): Promise<Decision> {
    this.waits.push({ pageId, waitSeconds });
    return new Promise<Decision>((resolve) => {
      this.resolveDecision = resolve;
    });
  }

  /** Called by the test: the human answered. */
  decide(decision: Partial<Decision> = {}): void {
    const resolve = this.resolveDecision;
    this.resolveDecision = null;
    resolve?.({
      status: decision.status ?? 'choice',
      choice: decision.choice ?? 'A',
      latencyMs: decision.latencyMs ?? 41_200,
    });
  }

  isOnline(): Promise<boolean> {
    return Promise.resolve(this.online);
  }

  getPageState(): Promise<string | null> {
    return this.withState ? Promise.resolve(this.state) : Promise.reject(new Error('not implemented'));
  }
}

/** Build a client without the optional state probe, to test the fallback. */
export function clientWithoutState(options: FakeCentralOptions = {}): BeeperClient {
  const fake = new FakeCentral({ ...options, withState: false });
  const { createPage, waitDecision, isOnline } = fake;
  return {
    createPage: (draft) => createPage.call(fake, draft),
    waitDecision: (id, seconds) => waitDecision.call(fake, id, seconds),
    isOnline: () => isOnline.call(fake),
  };
}
