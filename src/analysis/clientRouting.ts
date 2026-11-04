import type { Page } from 'playwright';

export interface ClientRoutingResult {
  isUsingNewParams: boolean;
  hasMutatedDom: boolean;
}

/**
 * Shared browser-side helper, inlined into both probes below: waits until the DOM has been quiet
 * for `idleTime` ms (but at least `minWait` ms have elapsed), tracking whether any mutation
 * happened at all. The MutationObserver is attached synchronously, before the caller dispatches the
 * popstate event that may trigger a router's (usually synchronous, for non-React routers) DOM
 * update — attaching it after dispatchEvent would miss exactly that common case.
 *
 * A hand-written JS source string, not a TS function literal passed to page.evaluate(): tsx/esbuild's
 * name-preservation transform injects `__name(...)` helper calls into compiled functions, and once
 * Playwright serializes such a function for the page, that helper (which only exists in this Node
 * process's module scope) is undefined there. A string literal is opaque to the compiler, so nothing
 * gets instrumented inside it.
 */
const WAIT_DOM_IDLE_SRC = `
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
`;

/**
 * Port of RAPIDOR's requestGenerator.js isUsingQueryParams/waitDOMIdle fallback: when a forged real
 * HTTP request for a query-param candidate does not look like it succeeded (or never could, because
 * the candidate value is never sent over the network at all — a purely client-routed SPA), check
 * whether the page's own client-side routing honors that query param anyway, independently of any
 * server response. Mutates the live page's location (pushState + a synthetic popstate, since raw
 * pushState alone does not fire anything) and watches whether the DOM reacts; always rolls the URL
 * back, even on an unexpected error. Requires `installParamUsageTracking` to have already run on
 * `page` (an init script, so it is in place before any app code loads).
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

    ${WAIT_DOM_IDLE_SRC}

    let hasMutatedDom = false;
    try {
      window.history.pushState({ ignore: true }, '', testUrl);
      // started BEFORE dispatchEvent: see WAIT_DOM_IDLE_SRC's doc comment above.
      const idle = waitDomIdle(500, 100);
      window.dispatchEvent(new Event('popstate'));
      hasMutatedDom = await idle;
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

/**
 * Path-segment analog of checkClientSideRouting, for candidates like busuu's
 * .../objective_<uuid>/... — a value that only ever appears in the page's own URL PATH, never in a
 * query string. Unlike URLSearchParams.get, there is no single API to hook across routers (React
 * Router, Next.js, a bespoke one...) that would tell us "the app read path segment N", so
 * `installParamUsageTracking`'s __accessedParams signal has no path equivalent here: this probe
 * relies on hasMutatedDom alone (isUsingNewParams mirrors it exactly) rather than "accessed &&
 * mutated" — a weaker, single-signal version of the query-param check above, since the DOM could in
 * principle mutate for an unrelated reason while the app ignores the new segment. `targetUrl` is the
 * full replacement URL (already spliced by the caller via spliceSegment): simpler than trying to
 * reconstruct a URLSearchParams-style builder for an arbitrary path shape.
 */
export async function checkClientSideRoutingForPath({ page, targetUrl }: {
  page: Page; targetUrl: string;
}): Promise<ClientRoutingResult> {
  const script = `(async () => {
    const targetUrl = ${JSON.stringify(targetUrl)};
    const originalUrl = window.location.href;

    ${WAIT_DOM_IDLE_SRC}

    let hasMutatedDom = false;
    try {
      window.history.pushState({ ignore: true }, '', targetUrl);
      // started BEFORE dispatchEvent: see WAIT_DOM_IDLE_SRC's doc comment above.
      const idle = waitDomIdle(500, 100);
      window.dispatchEvent(new Event('popstate'));
      hasMutatedDom = await idle;
    } finally {
      window.history.pushState({ ignore: true }, '', originalUrl);
      window.dispatchEvent(new Event('popstate'));
    }

    return { hasMutatedDom: hasMutatedDom, isUsingNewParams: hasMutatedDom };
  })()`;

  return page.evaluate(script) as Promise<ClientRoutingResult>;
}
