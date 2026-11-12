/**
 * Port of RAPIDOR's modules/HTTP/HTTPAnalyzer.js segment-extraction: given a captured request URL,
 * proposes every URL path segment and each query param as candidate "swap this value" targets.
 * No positional or shape heuristic: a candidate only produces requests if its value also appears
 * in the preindex (React state / JSON bodies), which already filters out static segments.
 */

export interface SegmentCandidate {
  value: string;
  parts: string[];   // spliceSegment inserts the replacement value at `index` and joins
  index: number;
  query?: string;     // original search string ("" or "?a=1"), re-attached after splicing a path candidate
  paramName?: string; // set only for query-param candidates: the key, needed by the client-routing fallback
}

/** Path-segment candidates (all of them) followed by query-param candidates. */
export function extractSegments({ url }: { url: string }): SegmentCandidate[] {
  const urlObj = new URL(url);
  const pathCandidates = getPathCandidates({ urlObj });
  const queryCandidates = getQueryCandidates({
    searchParams: urlObj.searchParams,
    fullPath: decodeURIComponent(urlObj.origin + urlObj.pathname),
    valuesToExclude: pathCandidates.map((c) => c.value),
  });
  return [...pathCandidates, ...queryCandidates];
}

function getPathCandidates({ urlObj }: { urlObj: URL }): SegmentCandidate[] {
  const pathname = urlObj.pathname;
  const hasTrailingSlash = pathname.endsWith('/');
  const segments = pathname.split('/').filter(Boolean);
  return segments.map((_, idx) => getPropertyAt({ urlObj, segments, idx, hasTrailingSlash, query: urlObj.search }));
}

function getPropertyAt({ urlObj, segments, idx, hasTrailingSlash, query }: {
  urlObj: URL; segments: string[]; idx: number; hasTrailingSlash: boolean; query: string;
}): SegmentCandidate {
  const segment = segments[idx];

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

function getQueryCandidates({ searchParams, fullPath, valuesToExclude = [] }: {
  searchParams: URLSearchParams; fullPath: string; valuesToExclude?: string[];
}): SegmentCandidate[] {
  const result: SegmentCandidate[] = [];
  for (const [key, value] of searchParams) {
    if (['true', 'false', ...valuesToExclude].includes(value)) continue;
    result.push({ parts: [`${fullPath}?${key}=`], value, index: 1, paramName: key });
  }
  return result;
}

/** Splices `value` into `parts` at `index` and joins; re-attaches `query` if the candidate carried one. */
export function spliceSegment({ parts, index, value, query }: { parts: string[]; index: number; value: string; query?: string }): string {
  const copy = [...parts];
  copy.splice(index, 0, value);
  return (copy.join('').trim()) + (query ?? '');
}
