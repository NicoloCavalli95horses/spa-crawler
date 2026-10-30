// Composition root: l'unico punto che conosce le classi concrete.
// Tutto il resto dipende solo dalle interfacce in core/interfaces.ts.
import type { CrawlConfig } from './config';
import { DfsExplorer } from './core/DfsExplorer';
import { SelectorBuilder } from './extraction/SelectorBuilder';
import { ClickableExtractor } from './extraction/ClickableExtractor';
import { PageTextExtractor } from './extraction/PageTextExtractor';
import { StabilityWaiter } from './browser/StabilityWaiter';
import { ActionExecutor } from './browser/ActionExecutor';
import { ExtensionCalls } from './browser/ExtensionCalls';
import { StateNavigator } from './browser/StateNavigator';
import { StateFingerprinter } from './state/StateFingerprinter';
import { StateCapturer } from './state/StateCapturer';
import { StateStore } from './state/StateStore';
import { StateGraph } from './state/StateGraph';
import { CrawleeOutput } from './state/output/CrawleeOutput';

/**
 * @param rootUrl URL da cui parte (e a cui torna) l'esplorazione, già dopo i redirect
 * @param site    etichetta del sito nei risultati; di default l'host di rootUrl
 */
export function buildExplorer(
  rootUrl: string, cfg: CrawlConfig, site = new URL(rootUrl).hostname,
): DfsExplorer {
  // 1. foglie: nessuna dipendenza da altri moduli
  // un prefisso per sito tiene separati screenshot e grafi quando si esplorano più siti
  const output = new CrawleeOutput(site);
  const selectorBuilder = new SelectorBuilder({
    gridPx: cfg.rectGridPx, includeText: cfg.text.inElementId,
  });
  const waiter = new StabilityWaiter(cfg.stability);
  const fingerprinter = new StateFingerprinter({
    includeUrl: cfg.includeUrlInFingerprint, includePageText: cfg.text.inStateFingerprint,
  });
  const textExtractor = new PageTextExtractor({
    maxBlocks: cfg.text.maxBlocks, maxBlockLength: cfg.text.maxBlockLength,
  });
  const store = new StateStore({ screenshots: cfg.screenshots }, output);
  const graph = new StateGraph(output);

  // 2. moduli che dipendono dalle foglie
  const extractor = new ClickableExtractor(selectorBuilder, cfg.blocklist);
  const capturer = new StateCapturer(extractor, textExtractor, fingerprinter);
  const executor = new ActionExecutor(new URL(rootUrl).origin, cfg.actionTimeoutMs, cfg.rectGridPx);
  const navigator = new StateNavigator(rootUrl, executor, waiter, capturer);

  // 3. l'algoritmo riceve tutto già pronto
  return new DfsExplorer(
    waiter, executor, capturer, navigator, store, graph,
    { maxDepth: cfg.maxDepth, maxStates: cfg.maxStates, maxDurationSecs: cfg.maxDurationSecs },
    cfg.extension && new ExtensionCalls(cfg.extension, output, cfg.actionTimeoutMs),
  );
}
