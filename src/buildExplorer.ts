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
import { CompositeHooks } from './core/CompositeHooks';
import type { IExplorationHooks } from './core/interfaces';
import { StateFingerprinter } from './state/StateFingerprinter';
import { StateCapturer } from './state/StateCapturer';
import { StateStore } from './state/StateStore';
import { StateGraph } from './state/StateGraph';
import { FileOutput } from './state/output/FileOutput';

/**
 * @param rootUrl URL where the exploration starts (and returns to), already past redirects
 * @param site    site label in the results; defaults to the host of rootUrl
 */
export function buildExplorer(
  rootUrl: string, cfg: CrawlConfig, site = new URL(rootUrl).hostname, network?: NetworkObserver,
): DfsExplorer {
  // 1. leaves: no dependencies on other modules
  // one folder per site and per run: <site>_<timestamp>
  const output = new FileOutput(site);
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

  // 2. modules that depend on the leaves
  const extractor = new ClickableExtractor(selectorBuilder, cfg.blocklist, cfg.ignoreClickablesWithin);
  const capturer = new StateCapturer(
    extractor, textExtractor, fingerprinter, cfg.dismissOverlays ? new OverlayDismisser() : undefined,
  );
  const executor = new ActionExecutor(new URL(rootUrl).origin, cfg.actionTimeoutMs, cfg.rectGridPx);
  const navigator = new StateNavigator(rootUrl, executor, waiter, capturer, new RequestThrottle(cfg.restoreDelayMs));

  // 3. the algorithm receives everything ready-made
  const maybeHooks: (IExplorationHooks | undefined)[] = [
    cfg.extension && new ExtensionCalls(cfg.extension, output, cfg.actionTimeoutMs),
    network && new NetworkObserverHooks(network, output),
  ];
  const hooks = maybeHooks.filter((h): h is IExplorationHooks => Boolean(h));

  return new DfsExplorer(
    waiter, executor, capturer, navigator, store, graph,
    { maxDepth: cfg.maxDepth, maxStates: cfg.maxStates, maxDurationSecs: cfg.maxDurationSecs },
    hooks.length > 0 ? new CompositeHooks(hooks) : undefined,
  );
}
