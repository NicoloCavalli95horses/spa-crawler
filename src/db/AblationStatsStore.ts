import type Database from 'better-sqlite3';

export interface AblationStatsRow {
  site: string;
  httpEvents: number;          // same http_events count the main pipeline saw for this site
  segmentsExtracted: number;   // URL path/query segments proposed as swap candidates (same extractSegments)
  jsonMatchesFound: number;    // leaf values inside a response body matching a segment's value (findJsonMatches)
  candidatesFound: number;     // sibling array-items proposed from those matches (findJsonCandidates)
  requestsGenerated: number;   // forged requests actually dispatched
  vulnerabilitiesFlagged: number;  // rows written to `ablation_vulnerabilities` for this site
  analysisMs: number;          // wall-clock time this runForSite() call took
}

export interface AblationStatsStoreOptions {
  db: Database.Database;
  clearOnStart: boolean;
}

/**
 * The ablation study's own stats table, one row per site — deliberately separate from
 * `analysis_stats` (same reasoning as AblationVulnerabilityStore: the whole point is comparing the
 * two, so they must never share a table). Column names mirror AnalysisStatsStore's where the
 * concept is the same (httpEvents, segmentsExtracted, candidatesFound, requestsGenerated,
 * vulnerabilitiesFlagged, analysisMs) so a comparison script can line the two up field by field;
 * `jsonMatchesFound` replaces `matchesFound` (preindex lookup hits) and there is no `reactStates`/
 * `explorationMs` here at all, since this mode never touches React state or re-explores anything —
 * it reuses the SAME http_events/crawl_states the main pipeline's exploration already produced.
 */
export class AblationStatsStore {
  private db: Database.Database;

  constructor({ db, clearOnStart }: AblationStatsStoreOptions) {
    this.db = db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ablation_stats (
        site TEXT PRIMARY KEY,
        http_events INTEGER NOT NULL,
        segments_extracted INTEGER NOT NULL,
        json_matches_found INTEGER NOT NULL,
        candidates_found INTEGER NOT NULL,
        requests_generated INTEGER NOT NULL,
        vulnerabilities_flagged INTEGER NOT NULL,
        analysis_ms INTEGER NOT NULL
      )
    `);
    if (clearOnStart) this.db.exec('DELETE FROM ablation_stats');
  }

  /** Removes every row for one site: used to overwrite a single domain's previous run without touching the others. */
  clearSite({ site }: { site: string }): void {
    this.db.prepare('DELETE FROM ablation_stats WHERE site = ?').run(site);
  }

  record(row: AblationStatsRow): void {
    this.db.prepare(`
      INSERT INTO ablation_stats (
        site, http_events, segments_extracted, json_matches_found, candidates_found,
        requests_generated, vulnerabilities_flagged, analysis_ms
      ) VALUES (
        @site, @httpEvents, @segmentsExtracted, @jsonMatchesFound, @candidatesFound,
        @requestsGenerated, @vulnerabilitiesFlagged, @analysisMs
      )
      ON CONFLICT(site) DO UPDATE SET
        http_events = @httpEvents, segments_extracted = @segmentsExtracted,
        json_matches_found = @jsonMatchesFound, candidates_found = @candidatesFound,
        requests_generated = @requestsGenerated, vulnerabilities_flagged = @vulnerabilitiesFlagged,
        analysis_ms = @analysisMs
    `).run(row);
  }

  all(): AblationStatsRow[] {
    const rows = this.db.prepare(`
      SELECT site, http_events, segments_extracted, json_matches_found, candidates_found,
        requests_generated, vulnerabilities_flagged, analysis_ms
      FROM ablation_stats ORDER BY site ASC
    `).all() as {
      site: string; http_events: number; segments_extracted: number; json_matches_found: number;
      candidates_found: number; requests_generated: number; vulnerabilities_flagged: number; analysis_ms: number;
    }[];
    return rows.map((r) => ({
      site: r.site, httpEvents: r.http_events, segmentsExtracted: r.segments_extracted,
      jsonMatchesFound: r.json_matches_found, candidatesFound: r.candidates_found,
      requestsGenerated: r.requests_generated, vulnerabilitiesFlagged: r.vulnerabilities_flagged,
      analysisMs: r.analysis_ms,
    }));
  }
}
