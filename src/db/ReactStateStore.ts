import type Database from 'better-sqlite3';

/** Loose on purpose: the graph's shape is owned by RAPIDOR, not the crawler. */
export interface RapidorGraph {
  fingerprint: string;
  [key: string]: unknown;
}

export interface ReactStateStoreOptions {
  db: Database.Database;   // shared connection (opened once per crawler run via openDatabase)
  clearOnStart: boolean;   // wipe react_states once, at construction
}

/**
 * Deduplicated persistence for React state graphs captured via window.__RAPIDOR__getLatestState,
 * keyed by the exact URL (including query params) they were observed at, so the same shape at two
 * different URLs is kept twice while a repeat at the same URL just bumps seen_count.
 */
export class ReactStateStore {
  private db: Database.Database;

  constructor({ db, clearOnStart }: ReactStateStoreOptions) {
    this.db = db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS react_states (
        id INTEGER PRIMARY KEY,
        site TEXT NOT NULL,
        url TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        graph TEXT NOT NULL,
        captured_at TEXT NOT NULL,
        seen_count INTEGER NOT NULL DEFAULT 1,
        UNIQUE(url, fingerprint)
      )
    `);
    if (clearOnStart) this.db.exec('DELETE FROM react_states');
  }

  /** No-ops when `graph` has no fingerprint: nothing usable to dedupe/store (extension absent or not yet settled). */
  record({ site, url, graph }: { site: string; url: string; graph: RapidorGraph | null | undefined }): void {
    if (!graph?.fingerprint) return;
    this.db.prepare(`
      INSERT INTO react_states (site, url, fingerprint, graph, captured_at)
      VALUES (@site, @url, @fingerprint, @graph, @capturedAt)
      ON CONFLICT(url, fingerprint) DO UPDATE SET seen_count = seen_count + 1
    `).run({
      site, url, fingerprint: graph.fingerprint, graph: JSON.stringify(graph), capturedAt: new Date().toISOString(),
    });
  }

  count(url?: string): number {
    const row = url
      ? this.db.prepare('SELECT COUNT(*) AS n FROM react_states WHERE url = ?').get(url)
      : this.db.prepare('SELECT COUNT(*) AS n FROM react_states').get();
    return (row as { n: number }).n;
  }
}
