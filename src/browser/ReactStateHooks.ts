import type { Page } from 'playwright';
import { log } from 'crawlee';
import type { IExplorationHooks } from '../core/interfaces';
import type { ReactStateStore, RapidorGraph } from '../db/ReactStateStore';
import type { PreindexedValueStore } from '../db/PreindexedValueStore';
import { evaluateInPage } from './evaluateInPage';

/** How every capture attempt resolved, logged at the end like ExtensionCalls' own handshake stats. */
interface CaptureStats { total: number; captured: number; noGraph: number; failed: number }

/**
 * Pulls the React state graph RAPIDOR already settled (via ExtensionCalls' own before/after-action
 * handshake) and persists it tied to the exact URL it was observed at, then (re)indexes it so the
 * analysis pipeline's match-finding can look it up by prop value. Runs on both beforeAction (covers
 * the root and every intermediate state, right before it's clicked away from) and afterAction
 * (covers every clicked-into state, including leaves) — together every visited state is captured at
 * least once; ReactStateStore's UNIQUE(url, fingerprint) absorbs the resulting overlap (keeping the
 * latest graph on a repeat, not just counting it — see ReactStateStore.record's own doc comment:
 * losing a capture to a stale duplicate is exactly the silent-coverage-loss failure mode this class
 * exists to avoid).
 */
export class ReactStateHooks implements IExplorationHooks {
  // visibility into how often a capture attempt actually yields something usable: with no logging
  // at all here before, a page that never settles in time (or whose extension call throws) failed
  // exactly as silently as a healthy duplicate — there was no way to tell the two apart from the logs.
  private stats: CaptureStats = { total: 0, captured: 0, noGraph: 0, failed: 0 };

  constructor(
    private store: ReactStateStore,
    private preindexStore?: PreindexedValueStore,
  ) {}

  async onStart(): Promise<void> {}

  async onEnd(): Promise<void> {
    if (this.stats.total === 0) return;
    const { total, captured, noGraph, failed } = this.stats;
    log.info(`react-state-capture: ${captured}/${total} captured, ${noGraph} no graph (not settled/no extension), ${failed} failed`);
  }

  beforeAction(page: Page): Promise<void> { return this.capture(page); }
  afterAction(page: Page): Promise<void> { return this.capture(page); }

  private async capture(page: Page): Promise<void> {
    this.stats.total++;
    try {
      const graph = await evaluateInPage(
        page,
        () => (window as unknown as { __RAPIDOR__getLatestState?: () => RapidorGraph | undefined })
          .__RAPIDOR__getLatestState?.() ?? null,
        undefined,
      );
      if (!graph) {
        this.stats.noGraph++;
        return;
      }
      const url = page.url();
      const stateId = this.store.record({ site: new URL(url).hostname, url, graph });
      if (stateId !== undefined) {
        this.preindexStore?.reindex({ stateId, graph });
        this.stats.captured++;
      } else {
        // graph had no fingerprint: record() itself no-ops (see its own doc comment)
        this.stats.noGraph++;
      }
    } catch {
      // extension absent, or page navigating/closed: never block the crawl, but still counted above
      this.stats.failed++;
    }
  }
}
