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

/** Marks a vulnerability/finding as tested purely client-side: no HTTP verb ever applied. */
const CLIENT_ROUTING_METHOD = 'CLIENT';

/**
 * Server-side port of RAPIDOR's preindex -> matchFinder -> requestGenerator -> responseEvaluator
 * chain: for every captured HTTP event of a site, proposes an alternative segment value (from a
 * sibling component instance), forges the replacement request, and flags+persists a vulnerability
 * when the response looks like it succeeded AND the differing props are authorization-relevant.
 *
 * Query params a SPA only ever reads itself — never sent to the backend in any request, so they'd
 * never be extracted at all if seeding came only from http_events — are seeded separately, from the
 * crawler's own captured page URLs (reactStateStore), and tested purely via checkClientSideRouting
 * (there is no server request to forge for these; see evaluateClientRoutingCandidate).
 *
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
    const { httpEventStore, reactStateStore, vulnerabilityStore, statsStore, options } = this.deps;
    const extractor = new SegmentExtractor();
    const events = httpEventStore.listBySite(site);
    const pageUrls = reactStateStore.listUrlsBySite(site);
    const seen = new Set<string>(); // dedup candidate requests within this run
    const tasks: (() => Promise<void>)[] = [];

    let segmentsExtracted = 0;
    let matchesFound = 0;
    let candidatesFound = 0;

    for (const event of events) {
      const found = this.findUrlCandidates({ extractor, url: event.url });
      segmentsExtracted += found.segments;
      matchesFound += found.matches;
      for (const { segment, candidate } of found.items) {
        candidatesFound++;
        const url = spliceSegment({ parts: segment.parts, index: segment.index, value: candidate.candidateValue, query: segment.query });
        const key = `http|${event.method}|${url}`;
        if (seen.has(key)) continue;
        seen.add(key);
        tasks.push(() => this.evaluateHttpCandidate({ page, site, event, url, candidate, segment }));
      }
    }

    for (const pageUrl of pageUrls) {
      const found = this.findUrlCandidates({ extractor, url: pageUrl });
      segmentsExtracted += found.segments;
      matchesFound += found.matches;
      for (const { segment, candidate } of found.items) {
        // path segments of the page's own route: no probe exists yet for these (checkClientSideRouting
        // only swaps a query param; replaying a client-routed path segment would need its own detector)
        const paramName = segment.paramName;
        if (!paramName) continue;
        candidatesFound++;
        const key = `client|${pageUrl}|${paramName}|${candidate.candidateValue}`;
        if (seen.has(key)) continue;
        seen.add(key);
        tasks.push(() => this.evaluateClientRoutingCandidate({ page, site, pageUrl, paramName, candidate }));
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

  /** Runs the preindex -> matchFinder steps for one URL (an http_event's or a crawled page's). */
  private findUrlCandidates({ extractor, url }: { extractor: SegmentExtractor; url: string }): {
    segments: number;
    matches: number;
    items: { segment: SegmentCandidate; candidate: ReturnType<typeof findCandidates>[number] }[];
  } {
    const { preindexStore, reactStateStore } = this.deps;
    let segments = 0;
    let matches = 0;
    const items: { segment: SegmentCandidate; candidate: ReturnType<typeof findCandidates>[number] }[] = [];

    for (const segment of extractor.extract(url)) {
      segments++;
      for (const match of preindexStore.findByValue(segment.value)) {
        matches++;
        const graph = reactStateStore.getById(match.stateId);
        if (!graph) continue;
        for (const candidate of findCandidates({ stateId: match.stateId, graph, nodeId: match.nodeId, path: match.path })) {
          items.push({ segment, candidate });
        }
      }
    }
    return { segments, matches, items };
  }

  private async evaluateHttpCandidate({ page, site, event, url, candidate, segment }: {
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

  /**
   * For a query param the SPA only ever reads client-side (its value never reaches any captured
   * HTTP request): there is no server response to forge/compare, so this goes straight to the
   * live pushState+popstate probe, mirroring the client-routing tail of evaluateHttpCandidate.
   */
  private async evaluateClientRoutingCandidate({ page, site, pageUrl, paramName, candidate }: {
    page: Page; site: string; pageUrl: string; paramName: string;
    candidate: ReturnType<typeof findCandidates>[number];
  }): Promise<void> {
    const { vulnerabilityStore, classifier } = this.deps;

    const clientRouting = await this.enqueueClientRoutingCheck({
      page, pageUrl, paramName, paramValue: candidate.candidateValue,
    });
    if (!clientRouting.isUsingNewParams) return;

    const differences = compareObj(candidate.referenceProps, candidate.candidateProps);
    const authz = await assessAuthZ({ differences, classifier });
    if (!authz.isAuthzRelevant) return;

    const candidateUrl = new URL(pageUrl);
    candidateUrl.searchParams.set(paramName, candidate.candidateValue);

    const id = vulnerabilityId({
      candidateValue: candidate.candidateValue, nodeId: candidate.candidateNodeId,
      method: CLIENT_ROUTING_METHOD, url: candidateUrl.href,
    });
    const inserted = vulnerabilityStore.record({
      id, site,
      referenceUrl: pageUrl, candidateUrl: candidateUrl.href, method: CLIENT_ROUTING_METHOD,
      referenceValue: String(candidate.referenceValue), candidateValue: candidate.candidateValue,
      motivation: describeDiffs(differences),
      detectionMethod: 'client-routing',
      responseSimilarity: null, authzDiff: authz,
    });
    if (inserted) {
      log.warning(`AnalysisPipeline: potential access control issue (client-routing) — ${pageUrl} -> ${candidateUrl.href}`);
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
