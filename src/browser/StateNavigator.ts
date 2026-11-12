import type { Page } from 'playwright';
import type {
  IStateNavigator, IActionExecutor, IStabilityWaiter,
} from '../core/interfaces';
import type { Action, ElementDescriptor, UIState } from '../core/types';

export interface PresenceRetry {
  timeoutMs: number;   // how long to keep re-checking for the element after a reload
  pollMs: number;      // gap between checks
}

export class StateNavigator implements IStateNavigator {
  private presence: PresenceRetry;

  constructor(
    private rootUrl: string,
    private executor: IActionExecutor,
    private waiter: IStabilityWaiter,
    private throttle?: { wait(): Promise<void> },   // spaces out reloads of the same site
    // after a reload the element may still be rendering: StabilityWaiter can report the page "stable"
    // during an early network lull, before an async data fetch (e.g. the MiniLearn lesson cards)
    // populates the DOM. So the post-reload presence check is retried for a short budget rather than
    // giving up on the first miss. 0ms disables it (tests). Default is deliberately small.
    presence: Partial<PresenceRetry> = {},
  ) {
    this.presence = { timeoutMs: 4_000, pollMs: 300, ...presence };
  }

  /**
   * Brings the page back to `target` so that `el` can be clicked. The match is tolerant on purpose:
   * the old exact-fingerprint equality (same URL + identical clickable-id set + identical page texts)
   * made restoring a dynamic landing page impossible — any reshuffle of featured cards, a changed
   * "Played" badge or a few pixels of layout shift produced a different id, `restore` returned false,
   * and every clickable that needed a reload to be reached (e.g. the MiniLesson cards) was abandoned
   * and never retried. Instead we accept the page as restored when it is on the same route (query
   * string included) AND the element we are about to click is present. Intermediate path actions are
   * still replayed exactly.
   */
  async restore(page: Page, target: UIState, el: ElementDescriptor): Promise<boolean> {
    if (sameRoute(page.url(), target.url) && (await this.locate(page, el))) return true;  // already there

    await this.throttle?.wait();
    await page.goto(this.rootUrl);                // refresh
    await this.waiter.waitForStable(page);
    for (const a of target.path) {               // replay the path
      if (!(await this.executor.execute(page, a))) return false;
      await this.waiter.waitForStable(page);
    }
    // on the right route, give an async-rendered target a short window to appear before giving up
    return sameRoute(page.url(), target.url) && (await this.locateWithRetry(page, el));
  }

  private locate(page: Page, el: ElementDescriptor): Promise<boolean> {
    const action: Action = { type: 'click', target: el };
    return this.executor.locate(page, action);
  }

  private async locateWithRetry(page: Page, el: ElementDescriptor): Promise<boolean> {
    const deadline = Date.now() + this.presence.timeoutMs;
    for (;;) {
      if (await this.locate(page, el)) return true;
      if (Date.now() >= deadline) return false;
      await page.waitForTimeout(this.presence.pollMs);
    }
  }
}

/**
 * Same origin, pathname, query string and hash. The query is compared too (order-independent): a
 * state such as MiniLesson?id=296 is a different resource from MiniLesson?id=297, so restoring must
 * land on the exact same URL, not merely the same path.
 */
function sameRoute(a: string, b: string): boolean {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    return ua.origin === ub.origin && ua.pathname === ub.pathname &&
      ua.hash === ub.hash && canonicalQuery(ua) === canonicalQuery(ub);
  } catch {
    return false;
  }
}

/** Query string with its parameters sorted, so ?a=1&b=2 and ?b=2&a=1 compare equal. */
function canonicalQuery(u: URL): string {
  const params = [...u.searchParams.entries()].sort(([ka, va], [kb, vb]) =>
    ka === kb ? va.localeCompare(vb) : ka.localeCompare(kb));
  return new URLSearchParams(params).toString();
}
