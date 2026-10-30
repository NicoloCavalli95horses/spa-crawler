import { pathToFileURL } from 'node:url';
import { PlaywrightCrawler, type FinalStatistics } from 'crawlee';
import { config as defaultConfig, type CrawlConfig } from './config';
import { buildExplorer } from './buildExplorer';

/** Margine oltre il budget di esplorazione: cattura finale e salvataggio del grafo. */
const HANDLER_MARGIN_SECS = 120;

export function createCrawler(cfg: CrawlConfig = defaultConfig): PlaywrightCrawler {
  return new PlaywrightCrawler({
    // ogni sito ha la sua pagina e il suo explorer: i siti possono girare in parallelo
    maxConcurrency: cfg.concurrency,
    requestHandlerTimeoutSecs: cfg.maxDurationSecs + HANDLER_MARGIN_SECS,
    // l'esplorazione vive in un'unica richiesta: un retry ripartirebbe da zero duplicando gli stati
    maxRequestRetries: 0,
    // un contesto isolato per pagina: cookie e tab separati tra un sito e l'altro
    launchContext: { useIncognitoPages: true },
    // Crawlee di default randomizza la viewport per sessione: renderebbe instabili i rettangoli
    browserPoolOptions: { useFingerprints: false },
    preNavigationHooks: [
      async ({ page }) => { await page.setViewportSize(cfg.viewport); },
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
