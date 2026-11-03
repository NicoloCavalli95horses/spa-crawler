/**
 * Prints crawl and analysis-pipeline statistics, and flagged vulnerabilities, straight from the
 * single SQLite file every store writes into — no daemon, no JSON files, nothing else to read.
 *
 *   npm run stats
 *   npm run stats -- --db storage/crawler.db
 */
import { parseArgs } from 'node:util';
import Database from 'better-sqlite3';
import { AnalysisStatsStore, type AnalysisStatsRow } from '../src/db/AnalysisStatsStore';
import { CrawlStateStore } from '../src/db/CrawlStateStore';
import { CrawlEdgeStore } from '../src/db/CrawlEdgeStore';
import { config } from '../src/config';

const { values: args } = parseArgs({ options: { db: { type: 'string', default: config.db.path } } });

const NUMERIC_FIELDS = [
  'httpEvents', 'segmentsExtracted', 'reactStates', 'matchesFound', 'candidatesFound', 'requestsGenerated', 'vulnerabilitiesFlagged',
] as const satisfies readonly (keyof AnalysisStatsRow)[];

const mean = (xs: number[]): number | null => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : null);
const fmt = (n: number | null): string => (n === null ? '-' : String(n));

const db = new Database(args.db!, { readonly: true });
const rows = new AnalysisStatsStore({ db, clearOnStart: false }).all();
const crawlStates = new CrawlStateStore({ db, clearOnStart: false });
const crawlEdges = new CrawlEdgeStore({ db, clearOnStart: false });

console.log(`${rows.length} site(s) analysed, from ${args.db}`);
console.table(rows.map((r) => ({
  site: r.site,
  states: crawlStates.count(r.site),
  edges: crawlEdges.count(r.site),
  ...Object.fromEntries(NUMERIC_FIELDS.map((f) => [f, r[f]])),
})));

console.log('\nAverage per site (where available):');
console.table({
  states: fmt(mean(rows.map((r) => crawlStates.count(r.site)))),
  edges: fmt(mean(rows.map((r) => crawlEdges.count(r.site)))),
  ...Object.fromEntries(NUMERIC_FIELDS.map((f) => [f, fmt(mean(rows.map((r) => r[f])))])),
});

const vulnerabilities = db.prepare(`
  SELECT site, reference_url, candidate_url, method, motivation, detection_method FROM vulnerabilities ORDER BY site ASC
`).all() as { site: string; reference_url: string; candidate_url: string; method: string; motivation: string; detection_method: string }[];

if (vulnerabilities.length) {
  console.log(`\n${vulnerabilities.length} flagged vulnerabilit${vulnerabilities.length === 1 ? 'y' : 'ies'}:`);
  console.table(vulnerabilities.map((v) => ({
    site: v.site, method: v.method, reference: v.reference_url, candidate: v.candidate_url,
    detection: v.detection_method, 'ratio/motivation': v.motivation,
  })));
}
