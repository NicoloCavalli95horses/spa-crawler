import type { Page } from 'playwright';

/**
 * Patches URLSearchParams.prototype.get globally (via an init script, so it is in place before any
 * app code runs) so analysis/clientRouting.ts can tell whether the page actually read a given query
 * parameter. Mirrors RAPIDOR's own requestGenerator.js detectParamsUsage() — not run here, since
 * RAPIDOR stays in 'minimal' mode and never constructs the module that does this; the crawler needs
 * its own copy to run the client-side-routing fallback itself.
 */
export async function installParamUsageTracking(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __accessedParams: Set<string> };
    w.__accessedParams = new Set();
    const originalGet = URLSearchParams.prototype.get;
    URLSearchParams.prototype.get = function (this: URLSearchParams, key: string) {
      w.__accessedParams.add(key);
      return originalGet.call(this, key);
    };
  });
}
