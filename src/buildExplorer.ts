// Composition root: the only place that knows the concrete classes.
// Everything else depends only on the interfaces in core/interfaces.ts.
import type { CrawlConfig } from './config';
import { DfsExplorer } from './core/DfsExplorer';
import { SelectorBuilder } from './extraction/SelectorBuilder';
import { ClickableExtractor } from './extraction/ClickableExtractor';
import { PageTextExtractor } from './extraction/PageTextExtractor';
import { StabilityWaiter } from './browser/StabilityWaiter';
import { ActionExecutor } from './browser/ActionExecutor';
import { ExtensionCalls } from './browser/ExtensionCalls';
import { StateNavigator } from './browser/StateNavigator';
import { OverlayDismisser } from './browser/OverlayDismisser';
import { RequestThrottle } from './browser/RequestThrottle';
import type { NetworkObserver } from './browser/NetworkObserver';
import { NetworkObserverHooks } from './browser/NetworkObserverHooks';
import type { ReactStateStore } from './db/ReactStateStore';
import type { PreindexedValueStore } from './db/PreindexedValueStore';
import { ReactStateHooks } from './browser/ReactStateHooks';
import type { HttpEventStore } from './db/HttpEventStore';
import type { VulnerabilityStore } from './db/VulnerabilityStore';
import type { AnalysisStatsStore } from './db/AnalysisStatsStore';
import type { CrawlStateStore } from './db/CrawlStateStore';
import type { CrawlEdgeStore } from './db/CrawlEdgeStore';
import type { AuthzClassifier } from './analysis/authzClassifier';
import { AnalysisPipeline } from './analysis/AnalysisPipeline';
import { AnalysisHooks } from './browser/AnalysisHooks';
import { CompositeHooks } from './core/CompositeHooks';
import type { IExplorationHooks } from './core/interfaces';
import { StateFingerprinter } from './state/StateFingerprinter';
import { StateCapturer } from './state/StateCapturer';
import { StateStore } from './state/StateStore';
import { StateGraph } from './state/StateGraph';

/**
 * Cross-cutting collaborators that live for the whole crawler run (shared across sites), not just
 * this one site's exploration. Everything except `network` is always on: NetworkObserver/
 * ReactStateHooks/the analysis pipeline have no per-run toggle anymore, so there is nothing left to
 * make optional here besides `network` itself (still looked up per-page from a WeakMap in main.ts).
 */
export interface ObservabilityDeps {
  network?: NetworkObserver;
  reactState: ReactStateStore;
  preindex: PreindexedValueStore;
  httpEventStore: HttpEventStore;
  vulnerabilityStore: VulnerabilityStore;
  statsStore: AnalysisStatsStore;
  crawlStates: CrawlStateStore;
  crawlEdges: CrawlEdgeStore;
  classifier: AuthzClassifier;
}

/**
 * @param rootUrl URL where the exploration starts (and returns to), already past redirects
 * @param site    site label in the results; defaults to the host of rootUrl
 */
export function buildExplorer(
  rootUrl: string, cfg: CrawlConfig, site: string, deps: ObservabilityDeps,
): DfsExplorer {
  const { network, reactState, preindex, httpEventStore, vulnerabilityStore, statsStore, crawlStates, crawlEdges, classifier } = deps;
  // 1. leaves: no dependencies on other modules
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
  const store = new StateStore({ screenshots: cfg.screenshots }, site, crawlStates);
  const graph = new StateGraph(site, crawlEdges);

  // 2. modules that depend on the leaves
  const extractor = new ClickableExtractor(selectorBuilder, cfg.blocklist, cfg.ignoreClickablesWithin);
  const capturer = new StateCapturer(
    extractor, textExtractor, fingerprinter, cfg.dismissOverlays ? new OverlayDismisser() : undefined,
  );
  const executor = new ActionExecutor(new URL(rootUrl).origin, cfg.actionTimeoutMs, cfg.rectGridPx);
  const navigator = new StateNavigator(rootUrl, executor, waiter, capturer, new RequestThrottle(cfg.restoreDelayMs));

  // 3. the algorithm receives everything ready-made
  const analysisPipeline = new AnalysisPipeline({
    httpEventStore, preindexStore: preindex, reactStateStore: reactState, crawlStateStore: crawlStates, vulnerabilityStore, statsStore, classifier,
    options: {
      maxConcurrentRequests: cfg.analysis.maxConcurrentRequests, timeBetweenRequestsMs: cfg.analysis.timeBetweenRequestsMs,
      dbPath: cfg.db.path, userDataDir: cfg.userDataDir, reportsDir: cfg.analysis.reportsDir,
      clientRoutingProbe: cfg.analysis.clientRoutingProbe,
    },
  });

  const maybeHooks: (IExplorationHooks | undefined)[] = [
    cfg.extension && new ExtensionCalls(cfg.extension, cfg.actionTimeoutMs),
    network && new NetworkObserverHooks(network),
    new ReactStateHooks(reactState, preindex),
    new AnalysisHooks(analysisPipeline, site),
  ];
  const hooks = maybeHooks.filter((h): h is IExplorationHooks => Boolean(h));

  return new DfsExplorer(
    waiter, executor, capturer, navigator, store, graph,
    { maxDepth: cfg.maxDepth, maxStates: cfg.maxStates, maxDurationSecs: cfg.maxDurationSecs },
    hooks.length > 0 ? new CompositeHooks(hooks) : undefined,
  );
}
