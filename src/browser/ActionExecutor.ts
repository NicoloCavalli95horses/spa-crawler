import type { Page } from 'playwright';
import { log } from 'crawlee';
import type { IActionExecutor } from '../core/interfaces';
import type { Action } from '../core/types';
import { evaluateInPage } from './evaluateInPage';
import { locateTarget } from './inPage/locateTarget';

export class ActionExecutor implements IActionExecutor {
  private guardedPages = new WeakSet<Page>();

  constructor(
    private allowedOrigin: string,   // blocca la navigazione fuori dominio
    private timeoutMs: number,
    private tolerancePx: number,     // scarto ammesso tra rettangolo salvato e attuale
  ) {}

  /** Non lancia mai: qualunque problema diventa false e il motore passa oltre. */
  async execute(page: Page, action: Action): Promise<boolean> {
    try {
      await this.installGuards(page);
      return await withTimeout(this.click(page, action), this.timeoutMs);
    } catch (err) {
      log.debug(`Azione su "${action.target.text ?? action.target.selector}" fallita: ${(err as Error).message}`);
      return false;
    }
  }

  private async click(page: Page, action: Action): Promise<boolean> {
    const t = action.target;
    const point = await evaluateInPage(page, locateTarget, {
      selector: t.selector, tag: t.tag, rect: t.rect, fixed: t.fixed, tolerancePx: this.tolerancePx,
    });
    if (!point) return false;
    // click alle coordinate: stessa semantica dell'hit-test usato in estrazione
    await page.mouse.click(point.x, point.y);
    return true;
  }

  /** Installate una volta per pagina. */
  private async installGuards(page: Page): Promise<void> {
    if (!this.guardedPages.has(page)) {
      this.guardedPages.add(page);

      // alert/confirm/prompt bloccano la pagina finché qualcuno non li chiude
      page.on('dialog', (d) => { d.dismiss().catch(() => {}); });

      // link target=_blank e window.open: si chiudono solo le tab aperte da questa pagina
      page.on('popup', (p) => { p.close().catch(() => {}); });

      // solo le richieste verso altre origini passano dall'handler
      await page.route(
        (url) => url.origin !== this.allowedOrigin,
        (route) => {
          const req = route.request();
          if (req.isNavigationRequest() && req.frame() === page.mainFrame()) {
            log.debug(`Navigazione esterna bloccata: ${req.url()}`);
            // con un 204 il browser resta sulla pagina corrente; abort mostrerebbe la pagina d'errore
            return route.fulfill({ status: 204 });
          }
          return route.fallback();
        },
      );
    }
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout di ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
