import type Database from 'better-sqlite3';
import type { Edge } from '../core/types';

export interface CrawlEdgeStoreOptions {
  db: Database.Database;   // shared connection (opened once per crawler run via openDatabase)
  clearOnStart: boolean;   // wipe crawl_edges once, at construction
}

/** The exploration's click graph (one row per edge), replacing the old state-graph.json. */
export class CrawlEdgeStore {
  private db: Database.Database;

  constructor({ db, clearOnStart }: CrawlEdgeStoreOptions) {
    this.db = db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS crawl_edges (
        id INTEGER PRIMARY KEY,
        site TEXT NOT NULL,
        from_state TEXT NOT NULL,
        to_state TEXT NOT NULL,
        action_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        text TEXT,
        selector TEXT NOT NULL
      )
    `);
    if (clearOnStart) this.db.exec('DELETE FROM crawl_edges');
  }

  /** Removes every row for one site: used to overwrite a single domain's previous run without touching the others. */
  clearSite({ site }: { site: string }): void {
    this.db.prepare('DELETE FROM crawl_edges WHERE site = ?').run(site);
  }

  /** Appends edges in one transaction: StateGraph only ever passes the ones not yet persisted. */
  recordMany({ site, edges }: { site: string; edges: Edge[] }): void {
    if (edges.length === 0) return;
    const insert = this.db.prepare(`
      INSERT INTO crawl_edges (site, from_state, to_state, action_type, target_id, text, selector)
      VALUES (@site, @from, @to, @actionType, @targetId, @text, @selector)
    `);
    this.db.transaction((rows: Edge[]) => {
      for (const e of rows) {
        insert.run({ site, from: e.from, to: e.to, actionType: e.action.type, targetId: e.action.targetId, text: e.action.text ?? null, selector: e.action.selector });
      }
    })(edges);
  }

  count(site: string): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM crawl_edges WHERE site = ?').get(site) as { n: number };
    return row.n;
  }
}
