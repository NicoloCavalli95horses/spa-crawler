import type { Page } from 'playwright';
import { log } from 'crawlee';
import type { IActionExecutor } from '../core/interfaces';
import type { Action } from '../core/types';
import { evaluateInPage } from './evaluateInPage';
import { locateTarget } from './inPage/locateTarget';

export class ActionExecutor implements IActionExecutor {
  private guardedPages = new WeakSet<Page>();

  constructor(
    private allowedOrigin: string,   // blocks off-domain navigation
    private timeoutMs: number,
    private tolerancePx: number,     // allowed deviation between the saved and the current rectangle
  ) {}

  /** Never throws: any problem becomes false and the engine moves on. */
  async execute(page: Page, action: Action): Promise<boolean> {
    try {
      await this.installGuards(page);
      return await withTimeout(this.click(page, action), this.timeoutMs);
    } catch (err) {
      log.debug(`Action on "${action.target.text ?? action.target.selector}" failed: ${(err as Error).message}`);
      return false;
    }
  }

  private async click(page: Page, action: Action): Promise<boolean> {
    const t = action.target;
    const point = await evaluateInPage(page, locateTarget, {
      selector: t.selector, tag: t.tag, rect: t.rect, fixed: t.fixed, tolerancePx: this.tolerancePx,
    });
    if (!point) return false;
    // click at coordinates: same semantics as the hit-test used during extraction
    await page.mouse.click(point.x, point.y);
    return true;
  }

  /** Installed once per page. */
  private async installGuards(page: Page): Promise<void> {
    if (!this.guardedPages.has(page)) {
      this.guardedPages.add(page);

      // alert/confirm/prompt block the page until someone dismisses them. beforeunload is accepted instead:
      // dismissing it cancels the navigation, so every restore of that tab would fail with ERR_ABORTED and the tab would stay stuck on the page
      page.on('dialog', (d) => { (d.type() === 'beforeunload' ? d.accept() : d.dismiss()).catch(() => {}); });

      // target=_blank links and window.open: only tabs opened by this page are closed
      page.on('popup', (p) => { p.close().catch(() => {}); });

      await this.blockExternalNavigation(page);
    }
  }

  /**
   * Intercepts documents only, via CDP. With page.route Playwright disables the HTTP cache and
   * every restore would re-download all the site's resources: this way they stay cached.
   */
  private async blockExternalNavigation(page: Page): Promise<void> {
    const cdp = await page.context().newCDPSession(page);
    // the main frame id stays the same across navigations; asking for it while a request is paused blocks the page
    const mainFrameId = (await cdp.send('Page.getFrameTree')).frameTree.frame.id;
    cdp.on('Fetch.requestPaused', async (e) => {
      try {
        if (e.frameId === mainFrameId && new URL(e.request.url).origin !== this.allowedOrigin) {
          log.debug(`External navigation blocked: ${e.request.url}`);
          // with a 204 the browser stays on the current page; failRequest would show the error page
          await cdp.send('Fetch.fulfillRequest', { requestId: e.requestId, responseCode: 204 });
        } else {
          await cdp.send('Fetch.continueRequest', { requestId: e.requestId });
        }
      } catch {
        // page closed in the meantime
      }
    });
    await cdp.send('Fetch.enable', { patterns: [{ resourceType: 'Document' }] });
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
