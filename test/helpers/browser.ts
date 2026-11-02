import { after, afterEach, before } from 'node:test';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

export const APP_ORIGIN = 'https://app.test';
export const VIEWPORT = { width: 1280, height: 800 };

/**
 * Registers before/after on the test file: one browser per file, a new context per page.
 * `open(pages)` serves the HTML pages on https://app.test without a real server.
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

  /** Page with only the given HTML (origin about:blank). */
  async function withHtml(html: string): Promise<Page> {
    const page = await newPage();
    await page.setContent(html);
    return page;
  }

  /** Pages served on APP_ORIGIN; opens the first one (or `start`). */
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
