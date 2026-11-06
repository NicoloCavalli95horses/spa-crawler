import 'dotenv/config'; // loads .env into process.env before any field below reads it
import os from 'node:os';
import path from 'node:path';

// dotenv does not expand variables: resolve a leading ~, $HOME or ${HOME} ourselves
function expandHome({ value }: { value: string }): string {
  const home = os.homedir();
  return path.resolve(value.replace(/^(~|\$HOME|\$\{HOME\})(?=\/|$)/, home));
}

export interface ExtensionCall {
  fn: string;  // name on window, e.g. '__RAPIDOR__getData'
  // - start: before the exploration;
  // - end: after the last state; before-action: before each action on a page;
  // - after-action: after each action, on the resulting page. before/after-action results are
  // treated as "ready"/"not ready" and never block the crawl.
  when: 'start' | 'end' | 'before-action' | 'after-action';
  args?: unknown[]; // arguments, JSON-serializable
}

export interface ExtensionConfig {
  path: string; // extension folder (the one with manifest.json), unpacked
  calls: ExtensionCall[];
}

export interface LightweightConfig {
  enabled: boolean;               // cheaper browsing while exploring: 1ms animations, no paint-only CSS, no images
  blockImages: boolean;           // images are not loaded (the layout is stable, so fingerprints stay consistent between runs)
  blockFonts: boolean;            // font files are not loaded: the text uses fallback fonts
  blockedUrlPatterns: string[];   // Chromium URL patterns (* wildcard) never requested: analytics, ads, session replay
  cacheStaticAssets: boolean;     // scripts/stylesheets are kept in memory: restoring a state does not download them again
  assetCacheMaxMb: number;        // cap on the memory used by that cache, per site
}

export interface CrawlConfig {
  startUrl: string;
  startUrls: string[];          // sites to explore in one run (`npm start`); when empty, only startUrl is explored
  maxDepth: number;
  maxStates: number;            // cap on the states saved by each tab: guarantees termination
  maxDurationSecs: number;      // time budget per site: then the exploration shuts down on its own
  concurrency: number;          // sites explored in parallel
  tabsPerSite: number;          // tabs exploring the same site together (same context: shared cookies and storage)
  restoreDelayMs: number;       // minimum gap between two reloads of the same site (all tabs together)
  viewport: { width: number; height: number };
  stability: { quietMs: number; timeoutMs: number; longRequestMs: number };
  rectGridPx: number;           // rectangle rounding in the fingerprint
  includeUrlInFingerprint: boolean;
  text: {
    inElementId: boolean;         // clickable's text in its id
    inStateFingerprint: boolean;  // visible page texts in the state fingerprint
    maxBlocks: number;
    maxBlockLength: number;
  };
  actionTimeoutMs: number;
  screenshots: boolean;         // saves a PNG image of each state (visual debugging only)
  headless: boolean;            // false: opens a browser window to watch the crawler in action
  locale: string;               // language requested from sites: keeps texts and blocklist consistent
  blocklist: string[];          // texts not to click (e.g. logout)
  ignoreClickablesWithin: string[];  // CSS selectors: never treat anything inside these as clickable (e.g. nav/header/footer chrome)
  dismissOverlays: boolean;     // close blocking modals (Escape / close control) before capturing, so an interstitial does not cost a depth level
  db: {
    path: string;                    // SQLite file, shared across the whole run (every site, every tab)
    clearOnStart: boolean;           // wipe http_events/react_states/preindexed_values/vulnerabilities/analysis_stats once at the start of each crawler run; true for debugging
    clearClassifierCache: boolean;   // wipe authz_classifications too; false by default: classifications are a pure function of the key string, independent of site/run, so they're worth keeping forever
  };
  analysis: {
    maxConcurrentRequests: number; // bounds forged-request concurrency; mirrors RAPIDOR's config.js maxConcurrentRequests
    timeBetweenRequestsMs: number; // pacing after each forged request; mirrors RAPIDOR's config.js timeBetweenRequests
    reportsDir: string;            // where each flagged finding's reproduction script lands: <reportsDir>/<site>/<findingId>.repro.ts
    // window the client-side-routing probe (checkClientSideRouting/checkClientSideRoutingForPath)
    // waits for a DOM mutation after a synthetic pushState+popstate. Was hardcoded at 500/100ms —
    // far shorter than the rest of the pipeline's own settle windows (stability.timeoutMs: 10s,
    // the extension's own wait-to-action: 3-8s, see config.extension.calls below), so an SPA route
    // change that triggers a real network fetch (e.g. a lazily-loaded exercise/resource) could
    // consistently read as "did not react", producing a false negative on every attempt rather
    // than a flaky one. Sized closer to those windows so a genuinely slow-but-real re-render is
    // still caught; still bounded so a route that truly ignores the segment doesn't stall analysis.
    clientRoutingProbe: { minWaitMs: number; idleMs: number };
    // Ablation study: runs a second, independent analysis pass (AblationPipeline) alongside the
    // main one, candidate-generating ONLY from the JSON bodies of already-captured HTTP responses
    // -- no React state, no component siblings, no client-routing probes at all. Its findings land
    // in their own tables (ablation_vulnerabilities/ablation_stats, never vulnerabilities/
    // analysis_stats) so the two are always comparable, never mixed. Off by default: it doubles the
    // forged-request traffic against the site under test for a comparison most runs don't need.
    ablationMode: boolean;
  };
  lightweight: LightweightConfig;
  extension?: ExtensionConfig;  // Chrome extension to load (optional)
  debugNoCrawling: boolean;     // opens the browser on the URL and waits for the user to close it, without exploring (manual login)
  userDataDir?: string;        // persistent browser profile (optional): cookies and storage survive across runs
  extraApiDomains: string[];   // backend domains to treat as first-party even though they don't share a base domain with startUrl (e.g. a CloudFront/API Gateway backend)
}

export const config: Readonly<CrawlConfig> = Object.freeze({
  startUrl: process.env.START_URL || 'http://localhost:3000',
  // START_URLS="https://a.com,https://b.com" (comma and/or newline separated, quoted in .env if on several lines), or fill the array here: replaces startUrl in `npm start`
  startUrls: (process.env.START_URLS || '').split(/[\s,]+/).filter(Boolean),
  maxDepth: 2,
  maxStates: 500,
  maxDurationSecs: 1800, // 30min
  concurrency: 1,
  tabsPerSite: 10,
  restoreDelayMs: 200,
  viewport: { width: 1920, height: 1080 },
  stability: { quietMs: 500, timeoutMs: 10_000, longRequestMs: 3_000 },
  rectGridPx: 4,
  includeUrlInFingerprint: true,
  // texts are normalized (digits -> '#'); on pages with random content
  text: { inElementId: true, inStateFingerprint: true, maxBlocks: 2000, maxBlockLength: 200 },
  actionTimeoutMs: 5_000,
  // PNG images of the states: not needed by the exploration, only to inspect it by eye
  screenshots: false,
  // HEADLESS=false npm start to see the browser
  headless: process.env.HEADLESS !== 'false',
  // browser locale and Accept-Language header: multilingual sites respond in English
  locale: 'en-US',
  // case-insensitive substring match on text, aria-label and href
  blocklist: ['logout', 'log out', 'sign out', 'quit', 'delete'],
  // skip clickables inside site chrome so exploration focuses on the main content; set to [] to explore everything
  ignoreClickablesWithin: ['nav', 'header', 'footer'],
  // close blocking modals (Escape, then an explicit close control) before capturing a state
  dismissOverlays: true,
  // single SQLite file every store
  db: { path: 'storage/crawler.db', clearOnStart: true, clearClassifierCache: false },
  // server-side IDOR analysis (preindex/match/forge/evaluate), ported from RAPIDOR's full-mode pipeline
  analysis: {
    maxConcurrentRequests: 3,
    timeBetweenRequestsMs: 250,
    reportsDir: 'reports',
    clientRoutingProbe: { minWaitMs: 3_000, idleMs: 300 },
    // ABLATION_MODE=true npm start to turn it on from the shell instead of editing this file
    ablationMode: process.env.ABLATION_MODE === 'true',
  },
  // USER_DATA_DIR enables a persistent profile (~ and $HOME are expanded); when unset, a temporary profile is used
  userDataDir: process.env.USER_DATA_DIR ? expandHome({ value: process.env.USER_DATA_DIR }) : undefined,
  // EXTRA_API_DOMAINS="api.example.com,d123.cloudfront.net" (comma-separated) for backends hosted off the app's own base domain
  extraApiDomains: (process.env.EXTRA_API_DOMAINS || 'd3vu3jnt00sinm.cloudfront.net').split(',').map((domain) => domain.trim()).filter(Boolean),
  // DEBUG_NO_CRAWLING=true: no exploration, the browser stays open until you close it (to log in manually into the persistent profile; use with HEADLESS=false)
  debugNoCrawling: process.env.DEBUG_NO_CRAWLING === 'true',
  // LIGHTWEIGHT=false turns it off; never active with DEBUG_NO_CRAWLING (manual login needs the real page)
  lightweight: {
    enabled: process.env.DEBUG_NO_CRAWLING !== 'true' && process.env.LIGHTWEIGHT !== 'false',
    blockImages: true,
    blockFonts: true,
    blockedUrlPatterns: [
      '*://www.google-analytics.com/*', '*://*.googletagmanager.com/*', '*://*.doubleclick.net/*',
      '*://connect.facebook.net/*', '*://*.hotjar.com/*', '*://*.clarity.ms/*', '*://*.segment.io/*',
      '*://*.segment.com/*', '*://*.fullstory.com/*',
    ],
    cacheStaticAssets: true,
    assetCacheMaxMb: 150,
  },
  // browser extension details: this is launched with the Chromium browser
  extension: {
    path: 'browser_extension/rapidor', // path to th extension (unpacked)
    calls: [
      // [called on start] clears the extension's shared IndexedDB once, so a run on a persistent profile starts clean
      { fn: '__RAPIDOR__reset', when: 'start' },
      // [called before an action on the page] force-settle and wait until React state has been captured for it
      // (otherwise a fast reload would navigate away before ReactStateHooks can read it)
      { fn: '__RAPIDOR__waitToAction', when: 'before-action', args: [{ timeoutMs: 3000 }] },
      // [called after an action on the page] settle again so the clicked-into state is ready the moment ReactStateHooks reads it
      { fn: '__RAPIDOR__waitToAction', when: 'after-action', args: [{ timeoutMs: 8000 }] },
      // [called on analysis end] kept only to surface extension runtime errors to the crawler log
      { fn: '__RAPIDOR__getData', when: 'end' },
    ],
  },
} as const satisfies CrawlConfig);
