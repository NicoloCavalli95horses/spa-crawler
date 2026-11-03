import type { Page } from 'playwright';
import type { IExplorationHooks } from '../core/interfaces';
import type { ReactStateStore, RapidorGraph } from '../db/ReactStateStore';
import { evaluateInPage } from './evaluateInPage';

/**
 * Pulls the React state graph RAPIDOR already settled (via ExtensionCalls' own before/after-action
 * handshake) and persists it tied to the exact URL it was observed at. Runs on both beforeAction
 * (covers the root and every intermediate state, right before it's clicked away from) and
 * afterAction (covers every clicked-into state, including leaves) — together every visited state is
 * captured at least once; ReactStateStore's UNIQUE(url, fingerprint) absorbs the resulting overlap.
 */
export class ReactStateHooks implements IExplorationHooks {
  constructor(private store: ReactStateStore) {}

  async onStart(): Promise<void> {}
  async onEnd(): Promise<void> {}

  beforeAction(page: Page): Promise<void> { return this.capture(page); }
  afterAction(page: Page): Promise<void> { return this.capture(page); }

  private async capture(page: Page): Promise<void> {
    try {
      const graph = await evaluateInPage(
        page,
        () => (window as unknown as { __RAPIDOR__getLatestState?: () => RapidorGraph | undefined })
          .__RAPIDOR__getLatestState?.() ?? null,
        undefined,
      );
      if (!graph) return;
      const url = page.url();
      this.store.record({ site: new URL(url).hostname, url, graph });
    } catch {
      // extension absent, or page navigating/closed: never block the crawl
    }
  }
}
