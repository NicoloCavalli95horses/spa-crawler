import type { Page } from 'playwright';
import { log } from 'crawlee';
import type { IStateStore } from '../core/interfaces';
import type { UIState } from '../core/types';
import type { CrawlStateStore } from '../db/CrawlStateStore';

export interface StateStoreOptions { screenshots: boolean }

/** Seen states and already explored (state, element) pairs, in memory; full records go to SQLite. */
export class StateStore implements IStateStore {
  private states = new Set<string>();
  private explored = new Set<string>();

  constructor(private opts: StateStoreOptions, private site: string, private persistent: CrawlStateStore) {}

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

  isExplored(stateId: string, elId: string): boolean {
    return this.explored.has(`${stateId}|${elId}`);
  }

  markExplored(stateId: string, elId: string): void {
    this.explored.add(`${stateId}|${elId}`);
  }
}
