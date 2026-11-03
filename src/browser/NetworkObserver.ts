import type { Page, Request, Response } from 'playwright';

export interface CapturedRequest {
  url: string;
  method: string;
  requestHeaders: Record<string, string>;
  postData?: string;
  status?: number;
  responseHeaders?: Record<string, string>;
  contentType?: string;
  responseBody?: string;
  timestamp: string;
}

export interface NetworkStats {
  total: number;
  byMethod: Record<string, number>;
  byStatus: Record<string, number>;
  failed: number;
  skippedOffDomain: number;
}

export interface NetworkObserverOptions {
  origin: string;
  maxBodyBytes?: number;   // caps the saved response body; default 200KB
}

const DEFAULT_MAX_BODY_BYTES = 200_000;

/**
 * Captures same-site fetch/XHR traffic directly via Playwright, as a crawler-side counterpart to
 * RAPIDOR's in-page HTTPTracker. `attach` can be called on several pages (tabs): they all feed the
 * same snapshot, mirroring RAPIDOR's own cross-tab aggregation.
 */
export class NetworkObserver {
  private baseDomain: string;
  private maxBodyBytes: number;
  private requests: CapturedRequest[] = [];
  private stats: NetworkStats = {
    total: 0, byMethod: {}, byStatus: {}, failed: 0, skippedOffDomain: 0,
  };

  constructor({ origin, maxBodyBytes = DEFAULT_MAX_BODY_BYTES }: NetworkObserverOptions) {
    this.baseDomain = baseDomain(new URL(origin).hostname);
    this.maxBodyBytes = maxBodyBytes;
  }

  attach(page: Page): void {
    page.on('requestfinished', (req) => { void this.handleFinished(req); });
    page.on('requestfailed', (req) => { this.handleFailed(req); });
  }

  snapshot(): { requests: CapturedRequest[]; stats: NetworkStats } {
    return { requests: this.requests, stats: this.stats };
  }

  /** Same-domain-or-subdomain check, mirroring HTTPAnalyzer.isAllowed/getBaseDomain in RAPIDOR. */
  private isSameSite(url: string): boolean {
    try {
      return baseDomain(new URL(url).hostname) === this.baseDomain;
    } catch {
      return false;
    }
  }

  private async handleFinished(req: Request): Promise<void> {
    if (req.resourceType() !== 'fetch' && req.resourceType() !== 'xhr') return;
    if (!this.isSameSite(req.url())) { this.stats.skippedOffDomain++; return; }

    const entry: CapturedRequest = {
      url: req.url(),
      method: req.method(),
      requestHeaders: await req.allHeaders().catch(() => ({})),
      postData: truncate(req.postData() ?? undefined, this.maxBodyBytes),
      timestamp: new Date().toISOString(),
    };

    const res = await req.response().catch(() => null);
    if (res) await this.fillResponse(entry, res);

    this.requests.push(entry);
    this.stats.total++;
    this.stats.byMethod[entry.method] = (this.stats.byMethod[entry.method] ?? 0) + 1;
    if (entry.status !== undefined) {
      const key = String(entry.status);
      this.stats.byStatus[key] = (this.stats.byStatus[key] ?? 0) + 1;
    }
  }

  private async fillResponse(entry: CapturedRequest, res: Response): Promise<void> {
    entry.status = res.status();
    entry.responseHeaders = await res.allHeaders().catch(() => ({}));
    entry.contentType = entry.responseHeaders['content-type'];
    // binary or already-consumed bodies just end up without a responseBody: best-effort only
    const text = await res.text().catch(() => undefined);
    entry.responseBody = truncate(text, this.maxBodyBytes);
  }

  private handleFailed(req: Request): void {
    if (req.resourceType() !== 'fetch' && req.resourceType() !== 'xhr') return;
    if (!this.isSameSite(req.url())) return;
    this.stats.failed++;
  }
}

function truncate(text: string | undefined, maxBytes: number): string | undefined {
  if (text === undefined) return undefined;
  return Buffer.byteLength(text) > maxBytes ? `${text.slice(0, maxBytes)}…[truncated]` : text;
}

/** Last two domain labels, e.g. "learn.pimsleur.com" -> "pimsleur.com" (same rule as RAPIDOR's). */
function baseDomain(hostname: string): string {
  return hostname.split('.').slice(-2).join('.');
}
