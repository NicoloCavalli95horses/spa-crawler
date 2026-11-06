import type { Page } from 'playwright';
import { log } from 'crawlee';
import type { IExplorationHooks } from '../core/interfaces';
import type { AblationPipeline } from '../analysis/AblationPipeline';

/**
 * Runs the ablation pipeline once, at the end of a site's exploration, on the still-open main page —
 * mirrors AnalysisHooks exactly, as a separate hook (not folded into AnalysisHooks itself) so the
 * two pipelines stay independent and this one is trivial to add/remove via config.analysis.ablationMode.
 * Runs AFTER the main pipeline (buildExplorer orders hooks so AnalysisHooks comes first): both read
 * the same already-captured http_events/crawl_states, neither mutates them, so the order between the
 * two doesn't affect either one's result — sequencing them just avoids two pipelines forging
 * requests through the same page/session at once.
 */
export class AblationHooks implements IExplorationHooks {
  constructor(
    private pipeline: AblationPipeline,
    private site: string,
  ) {}

  async onStart(): Promise<void> {}

  async onEnd(page: Page): Promise<void> {
    try {
      await this.pipeline.runForSite({ page, site: this.site });
    } catch (err) {
      log.warning(`AblationPipeline failed: ${(err as Error).message}`);
    }
  }
}
