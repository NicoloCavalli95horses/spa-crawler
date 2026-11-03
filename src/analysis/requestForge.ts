import type { Page } from 'playwright';

export interface ResponseLike {
  status: number;
  headers: Record<string, string>;
  body: string;
  contentType?: string;
}

/**
 * Dispatches a forged request via Playwright's APIRequestContext (page.request), which reuses the
 * browsing context's cookies but, unlike the page's own fetch/XHR, never fires page.on('request'/
 * 'requestfinished') — verified directly before building this. That means NetworkObserver never
 * sees or stores this probe traffic in http_events, so (unlike RAPIDOR, whose HTTPTracker sees
 * everything the page does) no _requestId/ignore tagging is needed here.
 */
export async function forgeRequest({ page, url, method, headers, postData }: {
  page: Page; url: string; method: string; headers?: Record<string, string>; postData?: string;
}): Promise<ResponseLike> {
  const res = await page.request.fetch(url, {
    method,
    headers,
    data: postData,
    failOnStatusCode: false,
  });
  const body = await res.text().catch(() => '');
  const responseHeaders = res.headers();
  return { status: res.status(), headers: responseHeaders, body, contentType: responseHeaders['content-type'] };
}

/** Port of RAPIDOR's utils.js runWithConcurrency: bounded-concurrency task pool. */
export async function runWithConcurrency<T>({ tasks, limit }: { tasks: (() => Promise<T>)[]; limit: number }): Promise<T[]> {
  const results = new Array<T>(tasks.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
