export interface ExtensionCall {
  fn: string;                              // name on window, e.g. '__RAPIDOR__getData'
  // start: before the exploration; end: after the last state; before-action: before each action on
  // a page; after-action: after each action, on the resulting page. before/after-action results are
  // treated as "ready"/"not ready" and never block the crawl.
  when: 'start' | 'end' | 'before-action' | 'after-action';
  args?: unknown[];              // arguments, JSON-serializable
}

export interface ExtensionConfig {
  path: string;                  // extension folder (the one with manifest.json), unpacked
  calls: ExtensionCall[];
}

export interface CrawlConfig {
  startUrl: string;
  maxDepth: number;
  maxStates: number;            // cap on the states saved by each tab: guarantees termination
  maxDurationSecs: number;      // time budget per site: then the exploration shuts down on its own
  concurrency: number;          // sites explored in parallel
  tabsPerSite: number;          // tabs exploring the same site together (same context: shared cookies and storage)
  restoreDelayMs: number;       // minimum gap between two reloads of the same site (all tabs together)
  viewport: { width: number; height: number };  // fixed: rectangles depend on the viewport
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
  };
  extension?: ExtensionConfig;  // Chrome extension to load (optional)
  // authentication is deliberately not configurable through env vars/files: log in once by hand
  // (HEADLESS=false + DEBUG_NO_CRAWLING=true, with userDataDir set) and the persistent profile
  // keeps cookies/tokens for every run afterwards. Less error-prone than copying credentials
  // around, and nothing secret ever needs to be written to disk as plain config.
  debugNoCrawling: boolean;     // opens the browser on the URL and waits for the user to close it, without exploring (manual login)
  userDataDir?: string;        // persistent browser profile (optional): cookies and storage survive across runs
}

export const config: Readonly<CrawlConfig> = Object.freeze({
  // the protocol is required, otherwise Crawlee discards the URL
  startUrl: process.env.START_URL ?? 'https://learn.pimsleur.com/MiniLearn',
  maxDepth: 2,
  maxStates: 500,
  maxDurationSecs: 1800,
  concurrency: 1,
  tabsPerSite: 5, // this must correlates to `maxStateSnapshots` in RAPIDOR, increase both if needed
  restoreDelayMs: 150,
  viewport: { width: 1920, height: 1080 },
  stability: { quietMs: 500, timeoutMs: 10_000, longRequestMs: 3_000 },
  rectGridPx: 4,
  includeUrlInFingerprint: true,
  // texts are normalized (digits -> '#'); on pages with random content
  // (recommendations, carousels) it is better to disable inStateFingerprint
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
  // deduplicated SQLite store the NetworkObserver/ReactStateHooks/AnalysisPipeline write into (shared by every tab/site in the run)
  db: { path: 'storage/http-events.db', clearOnStart: true, clearClassifierCache: false },
  // server-side IDOR analysis (preindex/match/forge/evaluate), ported from RAPIDOR's full-mode pipeline; always on
  analysis: { maxConcurrentRequests: 3, timeBetweenRequestsMs: 800 },
  // Chrome extension: call results end up in the KeyValueStore as
  // `<site>--extension-<when>-<fn>`. The functions must live in the page's MAIN world
  // (content script with "world": "MAIN" in the manifest), otherwise window cannot see them.
  // persistent profile: USER_DATA_DIR=/path/to/profile npm start. Do not point to the Chrome
  // profile in use (it is locked, and Chrome 136+ forbids automation on that folder):
  // use a dedicated folder, or a copy of the profile. Requires concurrency: 1.
  userDataDir: process.env.USER_DATA_DIR,
  // DEBUG_NO_CRAWLING=true: no exploration, the browser stays open until you close it
  // (to log in manually into the persistent profile; use with HEADLESS=false)
  debugNoCrawling: process.env.DEBUG_NO_CRAWLING === 'true',
  // RAPIDOR runs in 'minimal' mode (its own config.js): it only emits React state (Bridge+
  // StateManager), so the only calls that still matter are the settle/wait handshake around each
  // action (the crawler reads window.__RAPIDOR__getLatestState itself, via ReactStateHooks) and the
  // start/end bookkeeping. __RAPIDOR__waitForAnalysis is gone from this list on purpose: in minimal
  // mode it's a no-op that always resolves immediately (no AnalysisManager is ever constructed to
  // feed it work) now that the whole analysis pipeline runs server-side.
  extension: {
    path: '../rapidor/packages/react-devtools-extensions/chrome/build/unpacked',
    calls: [
      // clears the extension's shared IndexedDB once, so a run on a persistent profile starts clean
      { fn: '__RAPIDOR__reset', when: 'start' },
      // before acting on a page, force-settle and wait until React state has been captured for it
      // (otherwise a fast reload would navigate away before ReactStateHooks can read it)
      { fn: '__RAPIDOR__waitToAction', when: 'before-action', args: [{ timeoutMs: 3000 }] },
      // after acting, settle again so the clicked-into state is ready the moment ReactStateHooks reads it
      { fn: '__RAPIDOR__waitToAction', when: 'after-action', args: [{ timeoutMs: 8000 }] },
      // kept only to surface extension runtime errors to the crawler log (ExtensionCalls.reportRuntimeErrors);
      // its `stats` are not used for anything anymore — the crawler's own DB is the source of truth
      { fn: '__RAPIDOR__getData', when: 'end' },
    ],
  },
} as const satisfies CrawlConfig);
