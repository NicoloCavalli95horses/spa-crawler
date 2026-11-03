import type Database from 'better-sqlite3';
import { collectPreindexRows } from '../analysis/preindex';
import type { RapidorGraph } from './ReactStateStore';

export interface PreindexMatch {
  stateId: number;
  nodeId: string;
  path: (string | number)[];
  depth: number;
}

export interface PreindexedValueStoreOptions {
  db: Database.Database;   // shared connection (opened once per crawler run via openDatabase)
  clearOnStart: boolean;   // wipe preindexed_values once, at construction
}

/**
 * SQL equivalent of RAPIDOR's IndexedDB `PREINDEXING` store: one row per token (its multiEntry
 * index, flattened), so an exact-value lookup is a plain indexed equality query.
 */
export class PreindexedValueStore {
  private db: Database.Database;

  constructor({ db, clearOnStart }: PreindexedValueStoreOptions) {
    this.db = db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS preindexed_values (
        id INTEGER PRIMARY KEY,
        state_id INTEGER NOT NULL,
        node_id TEXT NOT NULL,
        value TEXT NOT NULL,
        path TEXT NOT NULL,
        depth INTEGER NOT NULL
      )
    `);
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_preindexed_values_value ON preindexed_values(value)');
    if (clearOnStart) this.db.exec('DELETE FROM preindexed_values');
  }

  /** Replaces this state's rows with a fresh preindex of its graph (cheap: one state at a time). */
  reindex({ stateId, graph }: { stateId: number; graph: RapidorGraph }): void {
    const nodes = graph.nodes ?? {};
    const rows = Object.entries(nodes).flatMap(([nodeId, node]) =>
      collectPreindexRows({ nodeId, key: node.key, props: node.props }));

    const insert = this.db.prepare(`
      INSERT INTO preindexed_values (state_id, node_id, value, path, depth)
      VALUES (@stateId, @nodeId, @value, @path, @depth)
    `);
    const replace = this.db.transaction(() => {
      this.db.prepare('DELETE FROM preindexed_values WHERE state_id = ?').run(stateId);
      for (const row of rows) {
        insert.run({ stateId, nodeId: row.nodeId, value: row.value, path: JSON.stringify(row.path), depth: row.depth });
      }
    });
    replace();
  }

  findByValue(value: string): PreindexMatch[] {
    const rows = this.db.prepare('SELECT state_id, node_id, path, depth FROM preindexed_values WHERE value = ?').all(value) as
      { state_id: number; node_id: string; path: string; depth: number }[];
    return rows.map((r) => ({ stateId: r.state_id, nodeId: r.node_id, path: JSON.parse(r.path), depth: r.depth }));
  }

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM preindexed_values').get() as { n: number }).n;
  }
}
