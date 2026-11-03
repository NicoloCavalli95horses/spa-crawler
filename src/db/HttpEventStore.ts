import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { CapturedRequest } from '../browser/NetworkObserver';

export interface HttpEventStoreOptions {
  db: Database.Database;   // shared connection (opened once per crawler run via openDatabase)
  clearOnStart: boolean;   // wipe http_events once, at construction
}

export interface HttpEventRow {
  method: string;
  url: string;
  status?: number;
  contentType?: string;
  requestHeaders: Record<string, string>;
  responseHeaders?: Record<string, string>;
  postData?: string;
  responseBody?: string;
}

/**
 * Deduplicated, cross-tab persistence for HTTP events captured by NetworkObserver, so later
 * analysis (match-finding, request-forging) sees each distinct exchange exactly once, tagged with
 * the app (site) it came from.
 */
export class HttpEventStore {
  private db: Database.Database;

  constructor({ db, clearOnStart }: HttpEventStoreOptions) {
    this.db = db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS http_events (
        id INTEGER PRIMARY KEY,
        site TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        method TEXT,
        url TEXT,
        status INTEGER,
        content_type TEXT,
        request_headers TEXT,
        response_headers TEXT,
        post_data TEXT,
        response_body TEXT,
        first_seen_at TEXT,
        seen_count INTEGER NOT NULL DEFAULT 1,
        UNIQUE(site, fingerprint)
      )
    `);
    if (clearOnStart) this.db.exec('DELETE FROM http_events');
  }

  /**
   * Inserts the request, or bumps seen_count if the same (site, fingerprint) was already stored:
   * the only place duplicates across tabs/reloads get collapsed.
   */
  record({ site, request }: { site: string; request: CapturedRequest }): void {
    this.db.prepare(`
      INSERT INTO http_events (
        site, fingerprint, method, url, status, content_type,
        request_headers, response_headers, post_data, response_body, first_seen_at
      ) VALUES (
        @site, @fingerprint, @method, @url, @status, @contentType,
        @requestHeaders, @responseHeaders, @postData, @responseBody, @firstSeenAt
      )
      ON CONFLICT(site, fingerprint) DO UPDATE SET seen_count = seen_count + 1
    `).run({
      site,
      fingerprint: fingerprintOf(request),
      method: request.method,
      url: request.url,
      status: request.status ?? null,
      contentType: request.contentType ?? null,
      requestHeaders: JSON.stringify(request.requestHeaders),
      responseHeaders: request.responseHeaders ? JSON.stringify(request.responseHeaders) : null,
      postData: request.postData ?? null,
      responseBody: request.responseBody ?? null,
      firstSeenAt: request.timestamp,
    });
  }

  count(site?: string): number {
    const row = site
      ? this.db.prepare('SELECT COUNT(*) AS n FROM http_events WHERE site = ?').get(site)
      : this.db.prepare('SELECT COUNT(*) AS n FROM http_events').get();
    return (row as { n: number }).n;
  }

  /** All distinct events for a site, in capture order — what the analysis pipeline iterates over. */
  listBySite(site: string): HttpEventRow[] {
    const rows = this.db.prepare('SELECT * FROM http_events WHERE site = ? ORDER BY id ASC').all(site) as {
      method: string; url: string; status: number | null; content_type: string | null;
      request_headers: string | null; response_headers: string | null; post_data: string | null; response_body: string | null;
    }[];
    return rows.map((r) => ({
      method: r.method,
      url: r.url,
      status: r.status ?? undefined,
      contentType: r.content_type ?? undefined,
      requestHeaders: r.request_headers ? JSON.parse(r.request_headers) : {},
      responseHeaders: r.response_headers ? JSON.parse(r.response_headers) : undefined,
      postData: r.post_data ?? undefined,
      responseBody: r.response_body ?? undefined,
    }));
  }
}

/** Same method+url with a different body counts as a distinct event; an identical repeat dedupes. */
function fingerprintOf(request: CapturedRequest): string {
  const bodyHash = createHash('sha1').update(request.postData ?? '').digest('hex');
  return `${request.method}|${request.url}|${bodyHash}`;
}
