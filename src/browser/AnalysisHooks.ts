import type { Page } from 'playwright';
import { log } from 'crawlee';
import type { IExplorationHooks } from '../core/interfaces';
import type { AnalysisPipeline } from '../analysis/AnalysisPipeline';

/** Runs the analysis pipeline once, at the end of a site's exploration, on the still-open main page. */
export class AnalysisHooks implements IExplorationHooks {
  constructor(
    private pipeline: AnalysisPipeline,
    private site: string,
  ) {}

  async onStart(): Promise<void> {}

  async onEnd(page: Page, explorationMs: number): Promise<void> {
    try {
      await this.pipeline.runForSite({ page, site: this.site, explorationMs });
    } catch (err) {
      log.warning(`AnalysisPipeline failed: ${(err as Error).message}`);
    }
  }
}
