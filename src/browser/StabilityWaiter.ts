import type { Page, Request } from 'playwright';
import { log } from 'crawlee';
import type { IStabilityWaiter } from '../core/interfaces';
import { evaluateInPage } from './evaluateInPage';

export interface StabilityOptions {
  quietMs: number;        // silence required on DOM and network
  timeoutMs: number;      // hard cap: past it we move on anyway
  longRequestMs: number;  // requests open for longer than this (long-poll, streaming) are ignored
  pollMs: number;
}

const IGNORED_TYPES = new Set(['websocket', 'eventsource', 'media', 'manifest', 'ping']);

/** Counts the in-flight network requests of a page. */
class NetworkTracker {
  private inflight = new Map<Request, number>();
  private lastActivity = Date.now();

  constructor(page: Page) {
    page.on('request', (r) => {
      if (IGNORED_TYPES.has(r.resourceType())) return;
      this.inflight.set(r, Date.now());
      this.lastActivity = Date.now();
    });
    const done = (r: Request) => {
      if (this.inflight.delete(r)) this.lastActivity = Date.now();
    };
    page.on('requestfinished', done);
    page.on('requestfailed', done);
  }

  isQuiet(quietMs: number, longRequestMs: number): boolean {
    const now = Date.now();
    for (const [req, start] of this.inflight) {
      if (now - start < longRequestMs) return false;
      if (now - start > 60_000) this.inflight.delete(req); // avoids piling up hung requests
    }
    return now - this.lastActivity >= quietMs;
  }
}

/** Runs in the browser: installs (once per document) a MutationObserver and reads the state. */
function probeDom(): { sinceMutation: number; animations: number; href: string } {
  const w = window as any;
  if (!w.__crawlerStability) {
    const state = { last: performance.now() };
    new MutationObserver(() => { state.last = performance.now(); }).observe(document, {
      subtree: true, childList: true, attributes: true, characterData: true,
    });
    w.__crawlerStability = state;
  }
  // infinite animations (spinners, decorative loaders) would never end: we ignore them
  const animations = document.getAnimations().filter((a) =>
    a.playState === 'running' &&
    Number.isFinite(Number(a.effect?.getComputedTiming().endTime ?? Infinity))).length;
  // the full URL, so query-param and hash changes count: SPAs (and the extension's client-side
  // query-param probing) change it via history.pushState, which a MutationObserver does not see
  return { sinceMutation: performance.now() - w.__crawlerStability.last, animations, href: location.href };
}

export class StabilityWaiter implements IStabilityWaiter {
  private trackers = new WeakMap<Page, NetworkTracker>();
  private opts: StabilityOptions;

  constructor(opts: Partial<StabilityOptions> & Pick<StabilityOptions, 'quietMs' | 'timeoutMs'>) {
    this.opts = { longRequestMs: 3_000, pollMs: 100, ...opts };
  }

  async waitForStable(page: Page): Promise<void> {
    const { quietMs, timeoutMs, longRequestMs, pollMs } = this.opts;
    const network = this.trackerFor(page);
    const start = Date.now();
    const deadline = start + timeoutMs;

    await page.waitForLoadState('domcontentloaded', { timeout: timeoutMs }).catch(() => {});

    let lastHref: string | undefined;
    let urlChangedAt = start;   // last time the URL (path, query or hash) changed

    while (Date.now() < deadline) {
      // during a navigation the context is destroyed: retry on the next round
      const dom = await evaluateInPage(page, probeDom, undefined).catch(() => null);
      if (dom) {
        if (lastHref !== undefined && dom.href !== lastHref) urlChangedAt = Date.now();
        lastHref = dom.href;
      }
      // silence must be counted from when we were called: after a click the DOM may have
      // been still for seconds, but the reaction (render, fetch) has not started yet
      const now = Date.now();
      const calm = now - start >= quietMs;
      const urlQuiet = now - urlChangedAt >= quietMs; // the URL must be idle too
      if (calm && urlQuiet && dom && dom.sinceMutation >= quietMs && dom.animations === 0 &&
          network.isQuiet(quietMs, longRequestMs)) {
        return;
      }
      await page.waitForTimeout(pollMs);
    }
    log.debug(`StabilityWaiter: timed out after ${timeoutMs}ms on ${page.url()}, moving on`);
  }

  private trackerFor(page: Page): NetworkTracker {
    let t = this.trackers.get(page);
    if (!t) {
      t = new NetworkTracker(page);
      this.trackers.set(page, t);
    }
    return t;
  }
}
