/**
 * Port of RAPIDOR's modules/HTTP/HTTPAnalyzer.js segment-extraction: given a captured request URL,
 * proposes the URL path segment and each query param as a candidate "swap this value" target.
 *
 * Deviation from RAPIDOR, deliberate: a path-segment candidate also carries the original query
 * string, and requestForge re-attaches it when splicing a replacement in. RAPIDOR's own
 * buildRequest drops the query entirely for path candidates, which breaks frameworks (e.g. Next.js
 * RSC fetches, `/x/y?_rsc=token`) where the query string changes how the same path is served.
 */

const MAX_SEGMENTS_HISTORY = 250; // mirrors RAPIDOR's config.js maxSegmentsHistoryLength

export interface SegmentCandidate {
  value: string;
  parts: string[];   // spliceSegment inserts the replacement value at `index` and joins
  index: number;
  query?: string;     // original search string ("" or "?a=1"), re-attached after splicing a path candidate
  paramName?: string; // set only for query-param candidates: the key, needed by the client-routing fallback
}

/** Stateful per analysis run: learns which path segment varies across a site's requests. */
export class SegmentExtractor {
  private segmentsHistory: string[][] = [];
  private segmentsHistoryKeys = new Set<string>();

  extract(url: string): SegmentCandidate[] {
    const urlObj = new URL(url);
    const query = urlObj.search;
    const fullPath = decodeURIComponent(urlObj.origin + urlObj.pathname);

    const pathCandidate = this.getPathCandidate(urlObj, query);
    const queryCandidates = this.getQueryCandidates({
      searchParams: urlObj.searchParams, fullPath, valuesToExclude: pathCandidate ? [pathCandidate.value] : [],
    });

    return [pathCandidate, ...queryCandidates].filter((c): c is SegmentCandidate => c !== undefined);
  }

  private getPathCandidate(urlObj: URL, query: string): SegmentCandidate | undefined {
    const pathname = urlObj.pathname;
    const hasTrailingSlash = pathname.endsWith('/');
    const segments = pathname.split('/').filter(Boolean);
    const idx = this.getIndexOfSegment(segments);
    this.updateSegmentsHistory(segments);
    return this.getPropertyAt({ urlObj, segments, idx, hasTrailingSlash, query });
  }

  /** The one index that differs from every previously-seen path with the same shape, else the last segment. */
  private getIndexOfSegment(newSegments: string[]): number {
    if (!this.segmentsHistory.length) return newSegments.length - 1;
    const candidateIndexes = new Set<number>();
    for (const oldSegments of this.segmentsHistory) {
      const maxLength = Math.max(oldSegments.length, newSegments.length);
      const diffIndexes: number[] = [];
      for (let i = 0; i < maxLength; i++) {
        if (oldSegments[i] !== newSegments[i]) diffIndexes.push(i);
      }
      if (diffIndexes.length === 1) candidateIndexes.add(diffIndexes[0]);
    }
    return candidateIndexes.size === 1 ? [...candidateIndexes][0] : newSegments.length - 1;
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
