import type { Page } from 'playwright';
import { log } from 'crawlee';
import type { IStateStore } from '../core/interfaces';
import type { UIState } from '../core/types';
import type { CrawlStateStore } from '../db/CrawlStateStore';

export interface StateStoreOptions {
  screenshots: boolean;
  /**
   * How many times a single (state, element) pair may be ATTEMPTED before it is given up as
   * unreachable. Restoring a state in a live SPA is non-deterministic: an interstitial that shows
   * up intermittently on load (a cookie/"welcome back" sheet) can cover the target on one landing
   * and be gone on the next, so a single miss must not permanently abandon the element — nor the
   * whole exploration branch hanging off it. Each clean miss (the element could not be located
   * after a restore) is retried on a later landing, up to this budget; then the pair is retired so
   * the state can eventually leave the frontier and the run terminates. An exception thrown during
   * the click itself is NOT retried (it signals a real error, not volatility). Minimum 1 (1 = the
   * old single-shot behaviour, no retry). Default 4.
   */
  restoreAttempts?: number;
}

/** The lifecycle of one (state, element) pair, kept in memory only. */
type PairStatus = { phase: 'untried' | 'inprogress' | 'done'; attempts: number };

/** Seen states and the per-(state, element) attempt bookkeeping, in memory; full records go to SQLite. */
export class StateStore implements IStateStore {
  private states = new Set<string>();
  private pairs = new Map<string, PairStatus>();
  private readonly maxAttempts: number;

  constructor(private opts: StateStoreOptions, private site: string, private persistent: CrawlStateStore) {
    this.maxAttempts = Math.max(1, opts.restoreAttempts ?? 4);
  }

  has(id: string): boolean {
    return this.states.has(id);
  }

  count(): number {
    return this.states.size;
  }

  async save(page: Page, state: UIState): Promise<void> {
    if (this.states.has(state.id)) return;
    this.states.add(state.id);   // before any await: the state counts as "seen" even if saving fails

    let screenshot: Buffer | undefined;
    if (this.opts.screenshots) {
      try {
        screenshot = await page.screenshot();
      } catch (err) {
        log.warning(`Screenshot of state ${state.id} failed: ${(err as Error).message}`);
      }
    }

    this.persistent.record({
      site: this.site,
      record: {
        id: state.id,
        url: state.url,
        depth: state.depth,
        path: state.path.map((a) => ({ type: a.type, targetId: a.target.id, text: a.target.text })),
        clickables: state.clickables,
        texts: state.texts,
      },
      screenshot,
    });
  }

  claim(stateId: string, elId: string): boolean {
    const pair = this.pair(stateId, elId);
    if (pair.phase !== 'untried') return false;   // done, or being attempted by another tab
    pair.phase = 'inprogress';
    return true;
  }

  release(stateId: string, elId: string, outcome: 'done' | 'miss'): void {
    const pair = this.pair(stateId, elId);
    if (outcome === 'done') {
      pair.phase = 'done';
      return;
    }
    pair.attempts++;
    // retry on a future landing while there is budget left; otherwise give up as unreachable
    pair.phase = pair.attempts >= this.maxAttempts ? 'done' : 'untried';
  }

  isDone(stateId: string, elId: string): boolean {
    return this.pairs.get(`${stateId}|${elId}`)?.phase === 'done';
  }

  isClaimable(stateId: string, elId: string): boolean {
    const phase = this.pairs.get(`${stateId}|${elId}`)?.phase;
    return phase === undefined || phase === 'untried';
  }

  /** The pair's status, created lazily as 'untried' on first touch. */
  private pair(stateId: string, elId: string): PairStatus {
    const key = `${stateId}|${elId}`;
    let status = this.pairs.get(key);
    if (!status) {
      status = { phase: 'untried', attempts: 0 };
      this.pairs.set(key, status);
    }
    return status;
  }
}
