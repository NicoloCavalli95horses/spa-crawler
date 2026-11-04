import type { Page, Route } from 'playwright';
import { log } from 'crawlee';
import type { LightweightConfig } from '../config';

/**
 * Cheaper browsing while exploring (never while the user logs in by hand). Everything here keeps the
 * layout and the DOM intact, since the state fingerprint depends on them: animations are shortened
 * (not removed, modals wait for their `animationend`), only paint-only CSS is dropped, and images are
 * not loaded.
 */

/** Paint-only CSS: costs GPU/CPU on every frame but never changes the geometry the fingerprint reads. */
const LIGHTWEIGHT_CSS = `
*, *::before, *::after {
  animation-duration: 1ms !important;
  animation-delay: 0s !important;
  animation-iteration-count: 1 !important;
  transition-duration: 1ms !important;
  transition-delay: 0s !important;
  scroll-behavior: auto !important;
  box-shadow: none !important;
  text-shadow: none !important;
  filter: none !important;
  backdrop-filter: none !important;
  will-change: auto !important;
  caret-color: transparent !important;
}
`;

/**
 * Init script source, run in the browser before any page script so the style is there from the first
 * paint. A string, not a function: tsx/esbuild inject helpers (`__name`) into serialized functions
 * that do not exist in the page.
 */
const INSTALL_STYLE_SCRIPT = `(() => {
  const install = () => {
    const style = document.createElement('style');
    style.setAttribute('data-crawler-lightweight', '');
    style.textContent = ${JSON.stringify(LIGHTWEIGHT_CSS)};
    (document.head || document.documentElement).appendChild(style);
  };
  if (document.documentElement) install();
  else new MutationObserver((_records, observer) => {
    if (!document.documentElement) return;
    observer.disconnect();
    install();
  }).observe(document, { childList: true });
})();`;

/** Chromium switches, for the launch (process-wide, so they cover every tab and the browser cache stays on). */
export function lightweightLaunchArgs({ lightweight }: { lightweight: LightweightConfig }): string[] {
  if (!lightweight.enabled) return [];
  return [
    ...(lightweight.blockImages ? ['--blink-settings=imagesEnabled=false'] : []),
    '--mute-audio',
    '--autoplay-policy=user-gesture-required',
  ];
}

/** Bodies of static assets already downloaded in this site's browser, reused by every later reload. */
export class StaticAssetCache {
  private entries = new Map<string, { status: number; headers: Record<string, string>; body: Buffer }>();
  private bytes = 0;
  hits = 0;
  misses = 0;

  constructor(private maxBytes: number) {}

  async handle({ route }: { route: Route }): Promise<void> {
    const request = route.request();
    const type = request.resourceType();
    if (request.method() !== 'GET' || (type !== 'script' && type !== 'stylesheet')) {
      return route.continue().catch(() => {});
    }
    const cached = this.entries.get(request.url());
    if (cached) {
      this.hits++;
      return route.fulfill(cached).catch(() => {});
    }
    this.misses++;
    try {
      const response = await route.fetch();
      const body = await response.body();
      if (response.status() === 200 && this.bytes + body.length <= this.maxBytes) {
        // content-encoding is already undone in body(), content-length would not match anymore
        const { 'content-encoding': _encoding, 'content-length': _length, ...headers } = response.headers();
        this.entries.set(request.url(), { status: 200, headers, body });
        this.bytes += body.length;
      }
      await route.fulfill({ response, body });
    } catch {
      await route.continue().catch(() => {});   // page closed or network error: let the browser deal with it
    }
  }

  summary(): string {
    return `${this.entries.size} assets (${(this.bytes / 1e6).toFixed(1)}MB), ${this.hits} hits / ${this.misses} fetched`;
  }
}

/**
 * Applies the in-page parts to one page: call it before the first navigation of each tab.
 * `assetCache` is shared by every tab of the site (same browser context, same URLs).
 */
export async function applyLightweightMode(
  { page, lightweight, assetCache }: { page: Page; lightweight: LightweightConfig; assetCache?: StaticAssetCache },
): Promise<void> {
  if (!lightweight.enabled) return;
  await page.addInitScript({ content: INSTALL_STYLE_SCRIPT });

  // Network.setBlockedURLs (unlike page.route) does not turn the browser HTTP cache off
  const blocked = [...lightweight.blockedUrlPatterns, ...(lightweight.blockFonts ? FONT_PATTERNS : [])];
  if (blocked.length > 0) {
    const session = await page.context().newCDPSession(page);
    await session.send('Network.enable');
    await session.send('Network.setBlockedURLs', { urls: blocked });
  }
  // page.route turns the browser cache off, hence the in-memory cache: only worth it if it replaces it
  if (assetCache) {
    await page.route('**/*', (route) => assetCache.handle({ route }));
  }
}

const FONT_PATTERNS = ['*.woff*', '*.ttf*', '*.otf*', '*.eot*'];

export function logAssetCacheSummary({ assetCache, site }: { assetCache?: StaticAssetCache; site: string }): void {
  if (assetCache) log.info(`Asset cache ${site}: ${assetCache.summary()}`);
}
