import { after, afterEach, before } from 'node:test';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

export const APP_ORIGIN = 'https://app.test';
export const VIEWPORT = { width: 1280, height: 800 };

/**
 * Registra before/after sul file di test: un browser per file, un contesto nuovo per pagina.
 * `open(pages)` serve le pagine HTML su https://app.test senza un server vero.
 */
export function useBrowser() {
  let browser: Browser;
  const contexts: BrowserContext[] = [];

  before(async () => { browser = await chromium.launch(); });
  afterEach(async () => { await Promise.all(contexts.splice(0).map((c) => c.close())); });
  after(async () => { await browser.close(); });

  async function newPage(): Promise<Page> {
    const context = await browser.newContext({ viewport: VIEWPORT });
    contexts.push(context);
    return context.newPage();
  }

  /** Pagina con il solo HTML dato (origine about:blank). */
  async function withHtml(html: string): Promise<Page> {
    const page = await newPage();
    await page.setContent(html);
    return page;
  }

  /** Pagine servite su APP_ORIGIN; si apre la prima (o `start`). */
  async function open(pages: Record<string, string>, start?: string): Promise<Page> {
    const page = await newPage();
    await page.route(`${APP_ORIGIN}/**`, (route) => {
      const path = new URL(route.request().url()).pathname;
      const body = pages[path];
      return body === undefined
        ? route.fulfill({ status: 404, body: 'not found' })
        : route.fulfill({ status: 200, contentType: 'text/html', body });
    });
    await page.goto(`${APP_ORIGIN}${start ?? Object.keys(pages)[0]}`);
    return page;
  }

  return { newPage, withHtml, open };
}
