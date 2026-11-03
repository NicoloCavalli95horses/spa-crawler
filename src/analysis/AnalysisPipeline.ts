import { createHash } from 'node:crypto';
import type { Page } from 'playwright';
import { log } from 'crawlee';
import type { HttpEventStore } from '../db/HttpEventStore';
import type { PreindexedValueStore } from '../db/PreindexedValueStore';
import type { ReactStateStore } from '../db/ReactStateStore';
import type { VulnerabilityStore } from '../db/VulnerabilityStore';
import { SegmentExtractor, spliceSegment } from './segments';
import { findCandidates } from './matchFinder';
import { forgeRequest, runWithConcurrency, sleep } from './requestForge';
import { getServerResponseSimilarity, compareObj } from './responseEvaluate';
import { assessAuthZ, type AuthzClassifier } from './authzClassifier';

export interface AnalysisPipelineOptions {
  maxConcurrentRequests: number;
  timeBetweenRequestsMs: number;
}

/**
 * Server-side port of RAPIDOR's preindex -> matchFinder -> requestGenerator -> responseEvaluator
 * chain: for every captured HTTP event of a site, proposes an alternative segment value (from a
 * sibling component instance), forges the replacement request, and flags+persists a vulnerability
 * when the response looks like it succeeded AND the differing props are authorization-relevant.
 */
export class AnalysisPipeline {
  constructor(
    private httpEventStore: HttpEventStore,
    private preindexStore: PreindexedValueStore,
    private reactStateStore: ReactStateStore,
    private vulnerabilityStore: VulnerabilityStore,
    private classifier: AuthzClassifier,
    private options: AnalysisPipelineOptions,
  ) {}

  async runForSite({ page, site }: { page: Page; site: string }): Promise<void> {
    const extractor = new SegmentExtractor();
    const events = this.httpEventStore.listBySite(site);
    const seen = new Set<string>(); // dedup candidate requests within this run (method+url)
    const tasks: (() => Promise<void>)[] = [];

    for (const event of events) {
      for (const segment of extractor.extract(event.url)) {
        for (const match of this.preindexStore.findByValue(segment.value)) {
          const graph = this.reactStateStore.getById(match.stateId);
          if (!graph) continue;

          for (const candidate of findCandidates({ stateId: match.stateId, graph, nodeId: match.nodeId, path: match.path })) {
            const url = spliceSegment({ parts: segment.parts, index: segment.index, value: candidate.candidateValue, query: segment.query });
            const key = `${event.method}|${url}`;
            if (seen.has(key)) continue;
            seen.add(key);
            tasks.push(() => this.evaluateCandidate({ page, site, event, url, candidate }));
          }
        }
      }
    }

    if (tasks.length === 0) return;
    log.info(`AnalysisPipeline: dispatching ${tasks.length} candidate request(s) for ${site}`);
    await runWithConcurrency({ tasks, limit: this.options.maxConcurrentRequests });
  }

  private async evaluateCandidate({ page, site, event, url, candidate }: {
    page: Page; site: string;
    event: ReturnType<HttpEventStore['listBySite']>[number];
    url: string;
    candidate: ReturnType<typeof findCandidates>[number];
  }): Promise<void> {
    const forged = await forgeRequest({ page, url, method: event.method, headers: event.requestHeaders, postData: event.postData });
    await sleep(this.options.timeBetweenRequestsMs);

    const similarity = getServerResponseSimilarity(
      { status: event.status ?? 0, headers: event.responseHeaders ?? {}, body: event.responseBody ?? '', contentType: event.contentType },
      forged,
    );
    if (!similarity.areSimilar) return;

    const differences = compareObj(candidate.referenceProps, candidate.candidateProps);
    const authz = await assessAuthZ({ differences, classifier: this.classifier });
    if (!authz.isAuthzRelevant) return;

    const id = vulnerabilityId({ candidateValue: candidate.candidateValue, nodeId: candidate.candidateNodeId, method: event.method, url });
    const inserted = this.vulnerabilityStore.record({
      id, site,
      referenceUrl: event.url, candidateUrl: url, method: event.method,
      referenceValue: String(candidate.referenceValue), candidateValue: candidate.candidateValue,
      responseSimilarity: similarity, authzDiff: authz,
    });
    if (inserted) {
      log.warning(`AnalysisPipeline: potential access control issue — ${event.method} ${event.url} -> ${url}`);
    }
  }
}

/** Same dedup id RAPIDOR's responseEvaluator.js computes (sha256 of candidate value + node id + method + url). */
function vulnerabilityId({ candidateValue, nodeId, method, url }: {
  candidateValue: string; nodeId: string; method: string; url: string;
}): string {
  return createHash('sha256').update(`current::${candidateValue}:nodeId:${nodeId}http::${method}:${url}`).digest('hex');
}
