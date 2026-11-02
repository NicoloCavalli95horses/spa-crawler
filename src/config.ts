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

export interface AuthConfig {
  bearerToken?: string;                  // becomes `Authorization: Bearer <token>`
  headers?: Record<string, string>;      // extra headers (take precedence over bearerToken)
  cookies?: Record<string, string>;      // session cookies, set on the site's domain
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
  extension?: ExtensionConfig;  // Chrome extension to load (optional)
  auth?: AuthConfig;            // credentials sent with every request to the explored site (optional)
  debugNoCrawling: boolean;     // opens the browser on the URL and waits for the user to close it, without exploring (manual login)
  userDataDir?: string;        // persistent browser profile (optional): cookies and storage survive across runs
}

/** "a=1; b=2" -> { a: '1', b: '2' } (format of the Cookie header copied from DevTools). */
function parseCookies(raw: string): Record<string, string> {
  return Object.fromEntries(raw.split(';').map((p) => p.trim()).filter(Boolean).map((p) => {
    const i = p.indexOf('=');
    return [p.slice(0, i), p.slice(i + 1)];
  }));
}

const auth: AuthConfig | undefined =
  process.env.AUTH_BEARER || process.env.AUTH_COOKIES || process.env.AUTH_HEADERS
    ? {
        bearerToken: process.env.AUTH_BEARER,
        cookies: process.env.AUTH_COOKIES ? parseCookies(process.env.AUTH_COOKIES) : undefined,
        headers: process.env.AUTH_HEADERS ? JSON.parse(process.env.AUTH_HEADERS) : undefined,
      }
    : undefined;

export const config: Readonly<CrawlConfig> = Object.freeze({
  // the protocol is required, otherwise Crawlee discards the URL
  startUrl: process.env.START_URL ?? 'https://learn.pimsleur.com/MiniLearn',
  maxDepth: 2,
  maxStates: 500,
  maxDurationSecs: 1800,
  concurrency: 1,
  tabsPerSite: 5,
  restoreDelayMs: 150,
  viewport: { width: 1280, height: 800 },
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
  // Chrome extension: call results end up in the KeyValueStore as
  // `<site>--extension-<when>-<fn>`. The functions must live in the page's MAIN world
  // (content script with "world": "MAIN" in the manifest), otherwise window cannot see them.
  // authentication, from environment variables only so that secrets are never committed:
  //   AUTH_BEARER=<token>  AUTH_COOKIES='sid=abc; lang=it'  AUTH_HEADERS='{"X-Api-Key":"k"}'
  auth,
  // persistent profile: USER_DATA_DIR=/path/to/profile npm start. Do not point to the Chrome
  // profile in use (it is locked, and Chrome 136+ forbids automation on that folder):
  // use a dedicated folder, or a copy of the profile. Requires concurrency: 1.
  userDataDir: process.env.USER_DATA_DIR,
  // DEBUG_NO_CRAWLING=true: no exploration, the browser stays open until you close it
  // (to log in manually into the persistent profile; use with HEADLESS=false)
  debugNoCrawling: process.env.DEBUG_NO_CRAWLING === 'true',
  extension: {
    path: '../rapidor/packages/react-devtools-extensions/chrome/build/unpacked',
    calls: [
      // clears the extension's shared IndexedDB once, so a run on a persistent profile starts clean
      { fn: '__RAPIDOR__reset', when: 'start' },
      // before acting on a page, wait until the extension has captured at least one state for it
      // (otherwise a fast reload would navigate away before React state is recorded)
      { fn: '__RAPIDOR__waitToAction', when: 'before-action', args: [{ timeoutMs: 3000 }] },
      // after acting, let the extension finish analysing the result (query-param probing, swapped-id
      // request/response evaluation) before we reload to the next element
      { fn: '__RAPIDOR__waitForAnalysis', when: 'after-action', args: [{ timeoutMs: 8000 }] },
      { fn: '__RAPIDOR__getData', when: 'end' },
    ],
  },
} as const satisfies CrawlConfig);
