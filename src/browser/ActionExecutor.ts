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

      await this.blockExternalNavigation(page);
    }
  }

  /**
   * Intercetta solo i documenti, via CDP. Con page.route Playwright spegne la cache HTTP e
   * ogni ripristino riscaricherebbe tutte le risorse del sito: così restano in cache.
   */
  private async blockExternalNavigation(page: Page): Promise<void> {
    const cdp = await page.context().newCDPSession(page);
    // l'id del frame principale resta lo stesso tra le navigazioni; chiederlo con la richiesta in pausa blocca la pagina
    const mainFrameId = (await cdp.send('Page.getFrameTree')).frameTree.frame.id;
    cdp.on('Fetch.requestPaused', async (e) => {
      try {
        if (e.frameId === mainFrameId && new URL(e.request.url).origin !== this.allowedOrigin) {
          log.debug(`Navigazione esterna bloccata: ${e.request.url}`);
          // con un 204 il browser resta sulla pagina corrente; failRequest mostrerebbe la pagina d'errore
          await cdp.send('Fetch.fulfillRequest', { requestId: e.requestId, responseCode: 204 });
        } else {
          await cdp.send('Fetch.continueRequest', { requestId: e.requestId });
        }
      } catch {
        // pagina chiusa nel frattempo
      }
    });
    await cdp.send('Fetch.enable', { patterns: [{ resourceType: 'Document' }] });
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout di ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
