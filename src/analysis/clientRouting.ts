import type { Page } from 'playwright';

export interface ClientRoutingResult {
  isUsingNewParams: boolean;
  hasMutatedDom: boolean;
}

/**
 * Port of RAPIDOR's requestGenerator.js isUsingQueryParams/waitDOMIdle fallback: when a forged real
 * HTTP request for a query-param candidate does not look like it succeeded (or never could, because
 * the candidate value is never sent over the network at all — a purely client-routed SPA), check
 * whether the page's own client-side routing honors that query param anyway, independently of any
 * server response. Mutates the live page's location (pushState + a synthetic popstate, since raw
 * pushState alone does not fire anything) and watches whether the DOM reacts; always rolls the URL
 * back, even on an unexpected error. Requires `installParamUsageTracking` to have already run on
 * `page` (an init script, so it is in place before any app code loads).
 *
 * The browser-side logic below is a hand-written JS source string, not a TS function literal
 * passed to page.evaluate(): tsx/esbuild's name-preservation transform injects `__name(...)` helper
 * calls into compiled functions, and once Playwright serializes such a function for the page, that
 * helper (which only exists in this Node process's module scope) is undefined there. A string
 * literal is opaque to the compiler, so nothing gets instrumented inside it.
 */
export async function checkClientSideRouting({ page, paramName, paramValue }: {
  page: Page; paramName: string; paramValue: string;
}): Promise<ClientRoutingResult> {
  const script = `(async () => {
    const paramName = ${JSON.stringify(paramName)};
    const paramValue = ${JSON.stringify(paramValue)};
    const w = window;
    if (w.__accessedParams) w.__accessedParams.clear();

    const originalUrl = window.location.href;
    const testUrl = new URL(originalUrl);
    testUrl.searchParams.set(paramName, paramValue);

    function waitDomIdle(minWait, idleTime) {
      return new Promise((resolve) => {
        let hasMutatedDom = false;
        let lastChange = Date.now();
        const start = Date.now();
        const observer = new MutationObserver(() => {
          hasMutatedDom = true;
          lastChange = Date.now();
        });
        observer.observe(document.body, { childList: true, subtree: true, attributes: true });
        function check() {
          const now = Date.now();
          if (now - start >= minWait && now - lastChange >= idleTime) {
            observer.disconnect();
            resolve(hasMutatedDom);
          } else {
            requestAnimationFrame(check);
          }
        }
        check();
      });
    }

    let hasMutatedDom = false;
    try {
      window.history.pushState({ ignore: true }, '', testUrl);
      window.dispatchEvent(new Event('popstate'));
      hasMutatedDom = await waitDomIdle(500, 100);
    } finally {
      window.history.pushState({ ignore: true }, '', originalUrl);
      window.dispatchEvent(new Event('popstate'));
    }

    return {
      hasMutatedDom: hasMutatedDom,
      isUsingNewParams: Boolean(w.__accessedParams && w.__accessedParams.has(paramName)) && hasMutatedDom,
    };
  })()`;

  return page.evaluate(script) as Promise<ClientRoutingResult>;
}
