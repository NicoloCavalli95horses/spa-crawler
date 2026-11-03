import type Database from 'better-sqlite3';

export interface AnalysisStatsRow {
  site: string;
  httpEvents: number;           // distinct same-site requests captured (http_events for this site)
  segmentsExtracted: number;    // URL path/query segments proposed as swap candidates
  reactStates: number;          // distinct React states captured (react_states for this site)
  matchesFound: number;         // preindexed-value hits for those segments
  candidatesFound: number;      // alternative component instances proposed from those matches
  requestsGenerated: number;    // forged requests actually dispatched
  vulnerabilitiesFlagged: number;   // rows written to `vulnerabilities` for this site
}

export interface AnalysisStatsStoreOptions {
  db: Database.Database;   // shared connection (opened once per crawler run via openDatabase)
  clearOnStart: boolean;   // wipe analysis_stats once, at construction
}

/**
 * One consolidated row per site with every number the user wants averaged across a run, so a
 * `SELECT AVG(...) FROM analysis_stats` is enough — no need to join http_events/react_states/
 * vulnerabilities separately just to compute an average.
 */
export class AnalysisStatsStore {
  private db: Database.Database;

  constructor({ db, clearOnStart }: AnalysisStatsStoreOptions) {
    this.db = db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS analysis_stats (
        site TEXT PRIMARY KEY,
        http_events INTEGER NOT NULL,
        segments_extracted INTEGER NOT NULL,
        react_states INTEGER NOT NULL,
        matches_found INTEGER NOT NULL,
        candidates_found INTEGER NOT NULL,
        requests_generated INTEGER NOT NULL,
        vulnerabilities_flagged INTEGER NOT NULL
      )
    `);
    if (clearOnStart) this.db.exec('DELETE FROM analysis_stats');
  }

  record(row: AnalysisStatsRow): void {
    this.db.prepare(`
      INSERT INTO analysis_stats (
        site, http_events, segments_extracted, react_states, matches_found, candidates_found, requests_generated, vulnerabilities_flagged
      ) VALUES (
        @site, @httpEvents, @segmentsExtracted, @reactStates, @matchesFound, @candidatesFound, @requestsGenerated, @vulnerabilitiesFlagged
      )
      ON CONFLICT(site) DO UPDATE SET
        http_events = @httpEvents, segments_extracted = @segmentsExtracted, react_states = @reactStates,
        matches_found = @matchesFound, candidates_found = @candidatesFound,
        requests_generated = @requestsGenerated, vulnerabilities_flagged = @vulnerabilitiesFlagged
    `).run(row);
  }

  all(): AnalysisStatsRow[] {
    const rows = this.db.prepare(`
      SELECT site, http_events, segments_extracted, react_states, matches_found, candidates_found, requests_generated, vulnerabilities_flagged
      FROM analysis_stats ORDER BY site ASC
    `).all() as {
      site: string; http_events: number; segments_extracted: number; react_states: number;
      matches_found: number; candidates_found: number; requests_generated: number; vulnerabilities_flagged: number;
    }[];
    return rows.map((r) => ({
      site: r.site, httpEvents: r.http_events, segmentsExtracted: r.segments_extracted, reactStates: r.react_states,
      matchesFound: r.matches_found, candidatesFound: r.candidates_found,
      requestsGenerated: r.requests_generated, vulnerabilitiesFlagged: r.vulnerabilities_flagged,
    }));
  }
}
