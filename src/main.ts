import { PlaywrightCrawler } from 'crawlee';
import { config } from './config';
import { buildExplorer } from './buildExplorer';

const crawler = new PlaywrightCrawler({
  maxConcurrency: 1,                 // la DFS mantiene stato nella pagina
  requestHandlerTimeoutSecs: config.handlerTimeoutSecs,  // il default di 60s è troppo basso
  // l'esplorazione vive in un'unica richiesta: un retry ripartirebbe da zero duplicando gli stati
  maxRequestRetries: 0,
  // Crawlee di default randomizza la viewport per sessione: renderebbe instabili i rettangoli
  browserPoolOptions: { useFingerprints: false },
  preNavigationHooks: [
    async ({ page }) => { await page.setViewportSize(config.viewport); },
  ],
  async requestHandler({ page, request, log }) {
    log.info(`Esplorazione di ${request.url}`);
    const explorer = buildExplorer(request.url, config);
    await explorer.explore(page);
  },
});

await crawler.run([config.startUrl]);
