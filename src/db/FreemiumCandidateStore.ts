import type Database from 'better-sqlite3';

export interface FreemiumCandidateRow {
  domain: string;
  rank: number | null;
  score: number;
  isReact: boolean;             // first filter: the engine only supports React apps
  reactEvidence: string[];      // what proved it (static marker, devtools hook, root container)
  keywordHits: string[];        // UI phrases close to a paywall concept (embedding match), most similar first
  billingScriptHits: string[];  // known billing-provider script hosts found in the markup
  renderedWithJs: boolean;      // true if the static fetch found nothing and a browser pass was needed
  error: string | null;         // fetch/navigation failure, if any (score is 0 in that case)
}

/** JSON since phrases can contain commas; rows written before that are comma-joined. */
function parseKeywordHits(raw: string): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return raw.split(',');
  }
}

/**
 * One row per domain checked by scripts/freemiumPrefilter.ts: a cheap triage score for how likely a
 * Tranco domain is to be a freemium app with a paid-feature preview, worth a manual login + full
 * exploration. Not a finding on its own — just narrows which domains are worth that manual step.
 */
export class FreemiumCandidateStore {
  private db: Database.Database;

  constructor({ db, clearOnStart }: { db: Database.Database; clearOnStart: boolean }) {
    this.db = db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS freemium_candidates (
        domain TEXT PRIMARY KEY,
        rank INTEGER,
        is_react INTEGER NOT NULL DEFAULT 0,
        react_evidence TEXT NOT NULL DEFAULT '',
        score INTEGER NOT NULL,
        keyword_hits TEXT NOT NULL,
        billing_script_hits TEXT NOT NULL,
        rendered_with_js INTEGER NOT NULL,
        error TEXT,
        checked_at TEXT NOT NULL
      )
    `);
    // tables created before the React filter existed
    const columns = (this.db.prepare('PRAGMA table_info(freemium_candidates)').all() as { name: string }[]).map((c) => c.name);
    if (!columns.includes('is_react')) this.db.exec('ALTER TABLE freemium_candidates ADD COLUMN is_react INTEGER NOT NULL DEFAULT 0');
    if (!columns.includes('react_evidence')) this.db.exec("ALTER TABLE freemium_candidates ADD COLUMN react_evidence TEXT NOT NULL DEFAULT ''");
    if (clearOnStart) this.db.exec('DELETE FROM freemium_candidates');
  }

  record(row: FreemiumCandidateRow): void {
    this.db.prepare(`
      INSERT INTO freemium_candidates (domain, rank, is_react, react_evidence, score, keyword_hits, billing_script_hits, rendered_with_js, error, checked_at)
      VALUES (@domain, @rank, @isReact, @reactEvidence, @score, @keywordHits, @billingScriptHits, @renderedWithJs, @error, @checkedAt)
      ON CONFLICT(domain) DO UPDATE SET
        rank = @rank, is_react = @isReact, react_evidence = @reactEvidence, score = @score, keyword_hits = @keywordHits, billing_script_hits = @billingScriptHits,
        rendered_with_js = @renderedWithJs, error = @error, checked_at = @checkedAt
    `).run({
      domain: row.domain, rank: row.rank, score: row.score,
      isReact: row.isReact ? 1 : 0, reactEvidence: row.reactEvidence.join(','),
      keywordHits: JSON.stringify(row.keywordHits), billingScriptHits: row.billingScriptHits.join(','),
      renderedWithJs: row.renderedWithJs ? 1 : 0, error: row.error, checkedAt: new Date().toISOString(),
    });
  }

  /** Every checked domain, React sites first, then highest score. */
  all(): (FreemiumCandidateRow & { checkedAt: string })[] {
    const rows = this.db.prepare('SELECT * FROM freemium_candidates ORDER BY is_react DESC, score DESC, domain ASC').all() as any[];
    return rows.map((r) => ({
      domain: r.domain, rank: r.rank, score: r.score,
      isReact: Boolean(r.is_react), reactEvidence: r.react_evidence ? r.react_evidence.split(',') : [],
      keywordHits: parseKeywordHits(r.keyword_hits),
      billingScriptHits: r.billing_script_hits ? r.billing_script_hits.split(',') : [],
      renderedWithJs: Boolean(r.rendered_with_js), error: r.error, checkedAt: r.checked_at,
    }));
  }
}
