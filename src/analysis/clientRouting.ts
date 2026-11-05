import type { Page } from 'playwright';

export interface ClientRoutingResult {
  isUsingNewParams: boolean;
  hasMutatedDom: boolean;
  // window.location.href right after the idle wait, before the probe rolls the URL back. Lets a
  // caller tell "the app rendered the candidate" apart from "the app's router rejected the candidate
  // and redirected elsewhere" — both mutate the DOM, but only the first is evidence of anything. See
  // isUsingNewParams's own redirect guard below for why this matters.
  finalUrl: string;
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
 *
 * `minWaitMs`/`idleMs` size the waitDomIdle window: AnalysisPipeline passes config.analysis.
 * clientRoutingProbe explicitly, sized to match the rest of the pipeline's own settle windows rather
 * than the much shorter 500/100ms this used to hardcode — see that config field's own comment.
 * Optional here (defaulting to that same config value) only so standalone scripts and previously
 * generated reproduction scripts that call this directly, without threading the config through,
 * keep compiling and behave the same as a real pipeline run.
 *
 * `isUsingNewParams` also requires the browser to still be sitting on `testUrl`'s own pathname once
 * the DOM settles: a false positive observed on busuu (dashboard/review -> dashboard/dashboard,
 * client-routing-path) showed the app's router silently redirecting an unrecognized route to its own
 * fallback (dashboard/timeline) — a real DOM mutation (the fallback page rendering), but evidence the
 * candidate was REJECTED, not accepted. Without this guard that redirect reads identically to a
 * genuine "the app rendered the candidate's content".
 */
export async function checkClientSideRouting({ page, paramName, paramValue, minWaitMs = 3_000, idleMs = 300 }: {
  page: Page; paramName: string; paramValue: string; minWaitMs?: number; idleMs?: number;
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
    let finalUrl = originalUrl;
    try {
      window.history.pushState({ ignore: true }, '', testUrl);
      // started BEFORE dispatchEvent: see WAIT_DOM_IDLE_SRC's doc comment above.
      const idle = waitDomIdle(${minWaitMs}, ${idleMs});
      window.dispatchEvent(new Event('popstate'));
      hasMutatedDom = await idle;
      finalUrl = window.location.href; // read before the rollback below moves it back
    } finally {
      window.history.pushState({ ignore: true }, '', originalUrl);
      window.dispatchEvent(new Event('popstate'));
    }

    const stayedOnTestPath = new URL(finalUrl).pathname === testUrl.pathname;

    return {
      hasMutatedDom: hasMutatedDom,
      finalUrl: finalUrl,
      isUsingNewParams: Boolean(w.__accessedParams && w.__accessedParams.has(paramName)) && hasMutatedDom && stayedOnTestPath,
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
 *
 * `minWaitMs`/`idleMs`: see checkClientSideRouting's own doc comment above (optional, same default).
 *
 * `isUsingNewParams` also requires the browser to still be on `targetUrl`'s own pathname once the
 * DOM settles — see checkClientSideRouting's own doc comment above for the busuu false positive
 * (a router redirecting an unrecognized path to its fallback) this guards against. It matters even
 * more here than in the query-param probe above: there is no __accessedParams signal for a path
 * segment at all, so hasMutatedDom used to be the ENTIRE signal — any redirect-away looked identical
 * to a genuine accept.
 */
export async function checkClientSideRoutingForPath({ page, targetUrl, minWaitMs = 3_000, idleMs = 300 }: {
  page: Page; targetUrl: string; minWaitMs?: number; idleMs?: number;
}): Promise<ClientRoutingResult> {
  const script = `(async () => {
    const targetUrl = ${JSON.stringify(targetUrl)};
    const originalUrl = window.location.href;

    ${WAIT_DOM_IDLE_SRC}

    let hasMutatedDom = false;
    let finalUrl = originalUrl;
    try {
      window.history.pushState({ ignore: true }, '', targetUrl);
      // started BEFORE dispatchEvent: see WAIT_DOM_IDLE_SRC's doc comment above.
      const idle = waitDomIdle(${minWaitMs}, ${idleMs});
      window.dispatchEvent(new Event('popstate'));
      hasMutatedDom = await idle;
      finalUrl = window.location.href; // read before the rollback below moves it back
    } finally {
      window.history.pushState({ ignore: true }, '', originalUrl);
      window.dispatchEvent(new Event('popstate'));
    }

    const stayedOnTargetPath = new URL(finalUrl).pathname === new URL(targetUrl).pathname;

    return { hasMutatedDom: hasMutatedDom, finalUrl: finalUrl, isUsingNewParams: hasMutatedDom && stayedOnTargetPath };
  })()`;

  return page.evaluate(script) as Promise<ClientRoutingResult>;
}
