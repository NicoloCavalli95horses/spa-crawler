import { createHash } from 'node:crypto';
import type { Page } from 'playwright';
import { log } from 'crawlee';
import type { HttpEventStore } from '../db/HttpEventStore';
import type { PreindexedValueStore } from '../db/PreindexedValueStore';
import type { ReactStateStore } from '../db/ReactStateStore';
import type { VulnerabilityStore } from '../db/VulnerabilityStore';
import type { AnalysisStatsStore } from '../db/AnalysisStatsStore';
import { SegmentExtractor, spliceSegment, type SegmentCandidate } from './segments';
import { findCandidates } from './matchFinder';
import { forgeRequest, runWithConcurrency, sleep } from './requestForge';
import { getServerResponseSimilarity, compareObj, describeDiffs } from './responseEvaluate';
import { assessAuthZ, type AuthzClassifier } from './authzClassifier';
import { checkClientSideRouting } from './clientRouting';

export interface AnalysisPipelineOptions {
  maxConcurrentRequests: number;
  timeBetweenRequestsMs: number;
}

export interface AnalysisPipelineDeps {
  httpEventStore: HttpEventStore;
  preindexStore: PreindexedValueStore;
  reactStateStore: ReactStateStore;
  vulnerabilityStore: VulnerabilityStore;
  statsStore: AnalysisStatsStore;
  classifier: AuthzClassifier;
  options: AnalysisPipelineOptions;
}

/**
 * Server-side port of RAPIDOR's preindex -> matchFinder -> requestGenerator -> responseEvaluator
 * chain: for every captured HTTP event of a site, proposes an alternative segment value (from a
 * sibling component instance), forges the replacement request, and flags+persists a vulnerability
 * when the response looks like it succeeded AND the differing props are authorization-relevant.
 * Every count along the way (segments extracted, matches found, candidates found, requests
 * generated) is recorded to AnalysisStatsStore, one row per site, for later averaging.
 */
export class AnalysisPipeline {
  // checkClientSideRouting mutates the shared page's live location/DOM; serialized so concurrent
  // candidate evaluations (bounded by maxConcurrentRequests) never race on it, mirroring RAPIDOR's
  // own enqueueNavigation() around the same operation.
  private clientRoutingQueue: Promise<unknown> = Promise.resolve();

  constructor(private deps: AnalysisPipelineDeps) {}

  async runForSite({ page, site }: { page: Page; site: string }): Promise<void> {
    const { httpEventStore, preindexStore, reactStateStore, vulnerabilityStore, statsStore, options } = this.deps;
    const extractor = new SegmentExtractor();
    const events = httpEventStore.listBySite(site);
    const seen = new Set<string>(); // dedup candidate requests within this run (method+url)
    const tasks: (() => Promise<void>)[] = [];

    let segmentsExtracted = 0;
    let matchesFound = 0;
    let candidatesFound = 0;

    for (const event of events) {
      for (const segment of extractor.extract(event.url)) {
        segmentsExtracted++;
        for (const match of preindexStore.findByValue(segment.value)) {
          matchesFound++;
          const graph = reactStateStore.getById(match.stateId);
          if (!graph) continue;

          for (const candidate of findCandidates({ stateId: match.stateId, graph, nodeId: match.nodeId, path: match.path })) {
            candidatesFound++;
            const url = spliceSegment({ parts: segment.parts, index: segment.index, value: candidate.candidateValue, query: segment.query });
            const key = `${event.method}|${url}`;
            if (seen.has(key)) continue;
            seen.add(key);
            tasks.push(() => this.evaluateCandidate({ page, site, event, url, candidate, segment }));
          }
        }
      }
    }

    if (tasks.length > 0) {
      log.info(`AnalysisPipeline: dispatching ${tasks.length} candidate request(s) for ${site}`);
      await runWithConcurrency({ tasks, limit: options.maxConcurrentRequests });
    }

    statsStore.record({
      site,
      httpEvents: events.length,
      segmentsExtracted,
      reactStates: reactStateStore.countBySite(site),
      matchesFound,
      candidatesFound,
      requestsGenerated: tasks.length,
      vulnerabilitiesFlagged: vulnerabilityStore.count(site),
    });
  }

  private async evaluateCandidate({ page, site, event, url, candidate, segment }: {
    page: Page; site: string;
    event: ReturnType<HttpEventStore['listBySite']>[number];
    url: string;
    candidate: ReturnType<typeof findCandidates>[number];
    segment: SegmentCandidate;
  }): Promise<void> {
    const { vulnerabilityStore, classifier, options } = this.deps;

    const forged = await forgeRequest({ page, url, method: event.method, headers: event.requestHeaders, postData: event.postData });
    await sleep(options.timeBetweenRequestsMs);

    const similarity = getServerResponseSimilarity(
      { status: event.status ?? 0, headers: event.responseHeaders ?? {}, body: event.responseBody ?? '', contentType: event.contentType },
      forged,
    );

    let detectionMethod: 'http' | 'client-routing' = 'http';
    if (!similarity.areSimilar) {
      // The forged request itself didn't look like it leaked anything (or outright failed) — for a
      // query-param candidate, check whether the SPA's own client-side routing honors it anyway,
      // independently of the server response (RAPIDOR's testClientSideQueryParamsUsage fallback).
      // By the time analysis runs (end of exploration), `page` may well be sitting on a different
      // state than the one this event was captured from, so it is navigated back to event.pageUrl
      // first — otherwise the pushState/popstate probe would run against the wrong React tree.
      if (!segment.paramName) return;
      const clientRouting = await this.enqueueClientRoutingCheck({
        page, pageUrl: event.pageUrl, paramName: segment.paramName, paramValue: candidate.candidateValue,
      });
      if (!clientRouting.isUsingNewParams) return;
      detectionMethod = 'client-routing';
    }

    const differences = compareObj(candidate.referenceProps, candidate.candidateProps);
    const authz = await assessAuthZ({ differences, classifier });
    if (!authz.isAuthzRelevant) return;

    const id = vulnerabilityId({ candidateValue: candidate.candidateValue, nodeId: candidate.candidateNodeId, method: event.method, url });
    const inserted = vulnerabilityStore.record({
      id, site,
      referenceUrl: event.url, candidateUrl: url, method: event.method,
      referenceValue: String(candidate.referenceValue), candidateValue: candidate.candidateValue,
      motivation: describeDiffs(differences),
      detectionMethod,
      responseSimilarity: similarity, authzDiff: authz,
    });
    if (inserted) {
      log.warning(`AnalysisPipeline: potential access control issue (${detectionMethod}) — ${event.method} ${event.url} -> ${url}`);
    }
  }

  private enqueueClientRoutingCheck(args: { page: Page; pageUrl: string; paramName: string; paramValue: string }) {
    const { page, pageUrl, ...rest } = args;
    const result = this.clientRoutingQueue.then(async () => {
      if (page.url() !== pageUrl) {
        await page.goto(pageUrl, { waitUntil: 'load', timeout: 10_000 }).catch(() => undefined);
      }
      return checkClientSideRouting({ page, ...rest });
    });
    this.clientRoutingQueue = result.catch(() => undefined);
    return result;
  }
}

/** Same dedup id RAPIDOR's responseEvaluator.js computes (sha256 of candidate value + node id + method + url). */
function vulnerabilityId({ candidateValue, nodeId, method, url }: {
  candidateValue: string; nodeId: string; method: string; url: string;
}): string {
  return createHash('sha256').update(`current::${candidateValue}:nodeId:${nodeId}http::${method}:${url}`).digest('hex');
}
