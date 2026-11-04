/**
 * Port of RAPIDOR's modules/HTTP/HTTPAnalyzer.js segment-extraction: given a captured request URL,
 * proposes URL path segments and each query param as candidate "swap this value" targets.
 *
 * Deviation from RAPIDOR, deliberate: a path-segment candidate also carries the original query
 * string, and requestForge re-attaches it when splicing a replacement in. RAPIDOR's own
 * buildRequest drops the query entirely for path candidates, which breaks frameworks (e.g. Next.js
 * RSC fetches, `/x/y?_rsc=token`) where the query string changes how the same path is served.
 *
 * Deviation #2: RAPIDOR (and this file, before) picked exactly one path segment per URL — the one
 * index that differs from every previously-seen path with the same shape, else the last segment.
 * That's too narrow for long paths with several dynamic segments (e.g. busuu's
 * .../course/start/objective_<uuid>/0_0_0_<hex>/activity_<uuid>/exercise_1): ties or multiple
 * differing indexes make the heuristic fall back to the last segment only, missing the actual id
 * segments earlier in the path. Since this analysis runs once, after the crawl, proposing a few
 * extra candidates per URL is cheap, so now both signals below contribute candidates instead of
 * only the single best guess:
 *  - historical variability (generalized: every index that has ever been the sole differing one in
 *    some comparison against the history, not just a globally unique such index)
 *  - a trailing window of the last N segments, N scaled to the path's length, taken unconditionally
 *    (no "looks like an id" shape test: ids are as often a raw short number as a uuid, so guessing
 *    from shape is more likely to misclassify than to help).
 */

const MAX_SEGMENTS_HISTORY = 250; // mirrors RAPIDOR's config.js maxSegmentsHistoryLength
const MAX_PATH_CANDIDATES = 4; // cap per URL regardless of how many indexes the two signals above produce

export interface SegmentCandidate {
  value: string;
  parts: string[];   // spliceSegment inserts the replacement value at `index` and joins
  index: number;
  query?: string;     // original search string ("" or "?a=1"), re-attached after splicing a path candidate
  paramName?: string; // set only for query-param candidates: the key, needed by the client-routing fallback
}

/** Stateful per analysis run: learns which path segments vary across a site's requests. */
export class SegmentExtractor {
  private segmentsHistory: string[][] = [];
  private segmentsHistoryKeys = new Set<string>();

  extract(url: string): SegmentCandidate[] {
    const urlObj = new URL(url);
    const query = urlObj.search;
    const fullPath = decodeURIComponent(urlObj.origin + urlObj.pathname);

    const pathCandidates = this.getPathCandidates(urlObj, query);
    const queryCandidates = this.getQueryCandidates({
      searchParams: urlObj.searchParams, fullPath, valuesToExclude: pathCandidates.map((c) => c.value),
    });

    return [...pathCandidates, ...queryCandidates];
  }

  private getPathCandidates(urlObj: URL, query: string): SegmentCandidate[] {
    const pathname = urlObj.pathname;
    const hasTrailingSlash = pathname.endsWith('/');
    const segments = pathname.split('/').filter(Boolean);

    const indexes = this.selectCandidateIndexes(segments);
    this.updateSegmentsHistory(segments);

    const candidates: SegmentCandidate[] = [];
    for (const idx of indexes) {
      const candidate = this.getPropertyAt({ urlObj, segments, idx, hasTrailingSlash, query });
      if (candidate) candidates.push(candidate);
    }
    return candidates;
  }

  /** Union of historically-variable indexes and the trailing window; falls back to the last segment if both are empty. */
  private selectCandidateIndexes(newSegments: string[]): number[] {
    const indexes = new Set<number>();
    for (const idx of this.getVaryingIndexes(newSegments)) indexes.add(idx);
    for (const idx of this.getTrailingWindowIndexes(newSegments.length)) indexes.add(idx);
    if (indexes.size === 0 && newSegments.length > 0) indexes.add(newSegments.length - 1);
    return [...indexes].slice(0, MAX_PATH_CANDIDATES);
  }

  /** Every index that was ever the sole differing one against some previously-seen path of the same shape. */
  private getVaryingIndexes(newSegments: string[]): Set<number> {
    const candidateIndexes = new Set<number>();
    for (const oldSegments of this.segmentsHistory) {
      const maxLength = Math.max(oldSegments.length, newSegments.length);
      const diffIndexes: number[] = [];
      for (let i = 0; i < maxLength; i++) {
        if (oldSegments[i] !== newSegments[i]) diffIndexes.push(i);
      }
      if (diffIndexes.length === 1) candidateIndexes.add(diffIndexes[0]);
    }
    return candidateIndexes;
  }

  /**
   * Indexes of the last N path segments, N scaled to the total segment count: 1 for short paths, up
   * to 3 for long ones (e.g. busuu's 7-segment lesson URLs). Taken unconditionally, regardless of the
   * segment's shape — the first segments of a path are usually domain/category, not identifiers, so
   * restricting to the tail already does most of the filtering without needing a shape guess.
   */
  private getTrailingWindowIndexes(segmentCount: number): number[] {
    const windowSize = segmentCount <= 2 ? 1 : segmentCount <= 4 ? 2 : 3;
    const indexes: number[] = [];
    for (let i = Math.max(0, segmentCount - windowSize); i < segmentCount; i++) indexes.push(i);
    return indexes;
  }

  private getPropertyAt({ urlObj, segments, idx, hasTrailingSlash, query }: {
    urlObj: URL; segments: string[]; idx: number; hasTrailingSlash: boolean; query: string;
  }): SegmentCandidate | undefined {
    if (idx < 0 || idx >= segments.length) return undefined;
    const segment = segments[idx];
    if (!segment) return undefined;

    const lastDot = segment.lastIndexOf('.');
    const hasExt = lastDot > 0;
    const value = hasExt ? segment.slice(0, lastDot) : segment;
    const ext = hasExt ? segment.slice(lastDot) : '';

    const before = segments.slice(0, idx);
    const after = segments.slice(idx + 1);
    const baseBefore = before.length ? `${before.join('/')}/` : '';
    const baseAfter = after.length ? `/${after.join('/')}` : '';

    const prefix = `${urlObj.origin}/${baseBefore}`;
    const suffix = (ext + baseAfter) + (hasTrailingSlash ? '/' : '');

    return { parts: [prefix, suffix], value, index: 1, query };
  }

  private updateSegmentsHistory(segments: string[]): void {
    const key = segments.join('/');
    if (this.segmentsHistoryKeys.has(key)) return;
    this.segmentsHistory.push([...segments]);
    this.segmentsHistoryKeys.add(key);
    if (this.segmentsHistory.length > MAX_SEGMENTS_HISTORY) {
      const removed = this.segmentsHistory.shift()!;
      this.segmentsHistoryKeys.delete(removed.join('/'));
    }
  }

  private getQueryCandidates({ searchParams, fullPath, valuesToExclude = [] }: {
    searchParams: URLSearchParams; fullPath: string; valuesToExclude?: string[];
  }): SegmentCandidate[] {
    const result: SegmentCandidate[] = [];
    for (const [key, value] of searchParams) {
      if (['true', 'false', ...valuesToExclude].includes(value)) continue;
      result.push({ parts: [`${fullPath}?${key}=`], value, index: 1, paramName: key });
    }
    return result;
  }
}

/** Splices `value` into `parts` at `index` and joins; re-attaches `query` if the candidate carried one. */
export function spliceSegment({ parts, index, value, query }: { parts: string[]; index: number; value: string; query?: string }): string {
  const copy = [...parts];
  copy.splice(index, 0, value);
  return (copy.join('').trim()) + (query ?? '');
}
