import { pathToFileURL } from 'node:url';
import { PlaywrightCrawler, Configuration, type FinalStatistics, type RequestOptions } from 'crawlee';
import { config as defaultConfig, type CrawlConfig, type ExtensionConfig } from './config';
import { buildExplorer } from './buildExplorer';
import { extensionLaunchArgs } from './browser/ExtensionCalls';
import { applyAuth } from './browser/Auth';

/** Margin beyond the exploration budget: final capture and graph saving. */
const HANDLER_MARGIN_SECS = 120;

// Crawlee only treats availableMemoryRatio of system RAM as its budget (default 0.25) and warns
// when ~90% of it is used. One site with several tabs and the browser extension easily exceeds a
// quarter of RAM, so we raise the default; CRAWLEE_AVAILABLE_MEMORY_RATIO still overrides it.
const DEFAULT_MEMORY_RATIO = 0.6;
if (!process.env.CRAWLEE_AVAILABLE_MEMORY_RATIO) {
  Configuration.getGlobalConfig().set('availableMemoryRatio', DEFAULT_MEMORY_RATIO);
}

/**
 * Chrome loads extensions only in a persistent context, with the new headless mode
 * (channel 'chromium'; the default headless shell does not support them).
 * One browser per site (maxOpenPagesPerBrowser: 1) with a temporary profile (userDataDir: '')
 * keeps the cookie and storage isolation that incognito pages would otherwise provide.
 * With cfg.userDataDir the profile is persistent instead (one browser at a time).
 */
function persistentBrowserOptions(cfg: CrawlConfig) {
  return {
    launchContext: {
      useIncognitoPages: false,
      userDataDir: cfg.userDataDir ?? '',
      launchOptions: {
        headless: cfg.headless,
        ...(cfg.extension ? { channel: 'chromium', args: extensionLaunchArgs(cfg.extension) } : {}),
        // in a persistent context, page options must be given at launch
        locale: cfg.locale,
        viewport: cfg.viewport,
      },
    },
    browserPoolOptions: { useFingerprints: false, maxOpenPagesPerBrowser: 1 },
  };
}

export function createCrawler(cfg: CrawlConfig = defaultConfig): PlaywrightCrawler {
  // several tabs per site require the persistent context: Crawlee forbids newPage() on incognito contexts
  const ext = cfg.extension || cfg.userDataDir || cfg.tabsPerSite > 1 ? persistentBrowserOptions(cfg) : undefined;
  if (cfg.userDataDir && cfg.concurrency > 1) {
    throw new Error('userDataDir requires concurrency: 1 (a profile cannot be shared between browsers)');
  }
  return new PlaywrightCrawler({
    // each site has its own page (more tabs with tabsPerSite) and its own explorer: sites can run in parallel
    maxConcurrency: cfg.concurrency,
    requestHandlerTimeoutSecs: cfg.debugNoCrawling ? 24 * 3600 : cfg.maxDurationSecs + HANDLER_MARGIN_SECS,
    // the exploration lives in a single request: a retry would start from scratch, duplicating states
    maxRequestRetries: 0,
    // an isolated context per page: cookies and tabs kept separate between sites
    launchContext: ext?.launchContext ?? {
      useIncognitoPages: true,
      // headful (visible window) when headless is false
      launchOptions: { headless: cfg.headless },
    },
    browserPoolOptions: ext?.browserPoolOptions ?? {
      // by default Crawlee randomizes the viewport per session: it would make rectangles unstable
      useFingerprints: false,
      // each incognito page has its own context: the locale sets navigator.language and Accept-Language
      prePageCreateHooks: [
        (_pageId, _controller, pageOptions) => { if (pageOptions) pageOptions.locale = cfg.locale; },
      ],
    },
    preNavigationHooks: [
      async ({ page, request }) => {
        await page.setViewportSize(cfg.viewport);
        if (cfg.auth) await applyAuth(page.context(), cfg.auth, request.url);
      },
    ],
    async requestHandler({ page, request, log }) {
      if (cfg.debugNoCrawling) {
        log.info('debugNoCrawling: log in manually and close the browser to finish');
        await page.context().waitForEvent('close', { timeout: 0 });
        return;
      }
      // after redirects (google.com -> www.google.com) the right origin is the loaded one
      const rootUrl = request.loadedUrl ?? request.url;
      // results stay labeled with the requested domain, even if it redirects elsewhere
      const site = new URL(request.url).hostname;
      // optional prefix set by the caller (e.g. "[3/10] #42" from the Tranco script)
      const progress = typeof request.userData.progress === 'string' ? `${request.userData.progress} ` : '';
      log.info(`${progress}Exploring ${site} (${rootUrl})`);
      // extra tabs in the same context: cookies and storage shared with the first one
      const extraPages = await Promise.all(
        Array.from({ length: Math.max(0, cfg.tabsPerSite - 1) }, async () => {
          const p = await page.context().newPage();
          await p.setViewportSize(cfg.viewport);
          return p;
        }),
      );
      try {
        await buildExplorer(rootUrl, cfg, site).explore(page, extraPages);
        log.info(`${progress}Finished ${site}`);
      } finally {
        await Promise.all(extraPages.map((p) => p.close().catch(() => {})));
      }
    },
  });
}

/** `requests` can be plain URLs or Crawlee request options (`userData.progress` prefixes the site logs). */
export async function runCrawler(
  requests: (string | RequestOptions)[], cfg: CrawlConfig = defaultConfig,
): Promise<FinalStatistics> {
  return createCrawler(cfg).run(requests);
}

// run directly (npm start): explores config.startUrl; imported: does nothing
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runCrawler([defaultConfig.startUrl]);
}
