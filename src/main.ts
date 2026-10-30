import { pathToFileURL } from 'node:url';
import { PlaywrightCrawler, type FinalStatistics } from 'crawlee';
import { config as defaultConfig, type CrawlConfig, type ExtensionConfig } from './config';
import { buildExplorer } from './buildExplorer';
import { extensionLaunchArgs } from './browser/ExtensionCalls';
import { applyAuth } from './browser/Auth';

/** Margine oltre il budget di esplorazione: cattura finale e salvataggio del grafo. */
const HANDLER_MARGIN_SECS = 120;

/**
 * Chrome carica le estensioni solo in un contesto persistente, con il nuovo headless
 * (channel 'chromium'; la headless shell di default non le supporta).
 * Un browser per sito (maxOpenPagesPerBrowser: 1) con profilo temporaneo (userDataDir: '')
 * mantiene l'isolamento di cookie e storage che altrimenti danno le pagine incognito.
 */
function extensionBrowserOptions(cfg: CrawlConfig & { extension: ExtensionConfig }) {
  return {
    launchContext: {
      useIncognitoPages: false,
      userDataDir: '',
      launchOptions: {
        headless: cfg.headless,
        channel: 'chromium',
        args: extensionLaunchArgs(cfg.extension),
        // in un contesto persistente le opzioni di pagina vanno date al lancio
        locale: cfg.locale,
        viewport: cfg.viewport,
      },
    },
    browserPoolOptions: { useFingerprints: false, maxOpenPagesPerBrowser: 1 },
  };
}

export function createCrawler(cfg: CrawlConfig = defaultConfig): PlaywrightCrawler {
  const ext = cfg.extension ? extensionBrowserOptions({ ...cfg, extension: cfg.extension }) : undefined;
  return new PlaywrightCrawler({
    // ogni sito ha la sua pagina e il suo explorer: i siti possono girare in parallelo
    maxConcurrency: cfg.concurrency,
    requestHandlerTimeoutSecs: cfg.maxDurationSecs + HANDLER_MARGIN_SECS,
    // l'esplorazione vive in un'unica richiesta: un retry ripartirebbe da zero duplicando gli stati
    maxRequestRetries: 0,
    // un contesto isolato per pagina: cookie e tab separati tra un sito e l'altro
    launchContext: ext?.launchContext ?? {
      useIncognitoPages: true,
      // headful (finestra visibile) quando headless è false
      launchOptions: { headless: cfg.headless },
    },
    browserPoolOptions: ext?.browserPoolOptions ?? {
      // Crawlee di default randomizza la viewport per sessione: renderebbe instabili i rettangoli
      useFingerprints: false,
      // ogni pagina incognito ha il suo contesto: il locale fissa navigator.language e Accept-Language
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
      // dopo i redirect (google.com -> www.google.com) l'origine giusta è quella caricata
      const rootUrl = request.loadedUrl ?? request.url;
      log.info(`Esplorazione di ${rootUrl}`);
      // i risultati restano etichettati con il dominio richiesto, anche se reindirizza altrove
      await buildExplorer(rootUrl, cfg, new URL(request.url).hostname).explore(page);
    },
  });
}

export async function runCrawler(urls: string[], cfg: CrawlConfig = defaultConfig): Promise<FinalStatistics> {
  return createCrawler(cfg).run(urls);
}

// eseguito direttamente (npm start): esplora config.startUrl; importato: non fa nulla
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runCrawler([defaultConfig.startUrl]);
}
