/**
 * Compares the main (React-state-informed) analysis against the HTTP-JSON-only ablation
 * (config.analysis.ablationMode), straight from the same SQLite file both write into — analysis_stats/
 * vulnerabilities for the former, ablation_stats/ablation_vulnerabilities for the latter (see
 * AblationPipeline's own doc comment for why they never share a table).
 *
 *   npm run compare-ablation
 *   npm run compare-ablation -- --db storage/crawler.db
 */
import { parseArgs } from 'node:util';
import Database from 'better-sqlite3';
import { AnalysisStatsStore } from '../src/db/AnalysisStatsStore';
import { AblationStatsStore } from '../src/db/AblationStatsStore';
import { config } from '../src/config';

const { values: args } = parseArgs({ options: { db: { type: 'string', default: config.db.path } } });

const db = new Database(args.db!, { readonly: true });

// readonly connection: AblationStatsStore's own constructor would fail trying CREATE TABLE IF NOT
// EXISTS on a table that genuinely doesn't exist yet (a db from a run that never had ablationMode
// on) — check first instead of trying and catching.
const hasAblationTable = db.prepare(
  "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'ablation_stats'",
).get() !== undefined;
if (!hasAblationTable) {
  console.log(`No ablation_stats table in ${args.db} — re-run with ABLATION_MODE=true (or config.analysis.ablationMode: true) first.`);
  process.exit(0);
}

const mainStats = new AnalysisStatsStore({ db, clearOnStart: false }).all();
const ablationStats = new AblationStatsStore({ db, clearOnStart: false }).all();

if (ablationStats.length === 0) {
  console.log(`ablation_stats is empty in ${args.db} — re-run with ABLATION_MODE=true (or config.analysis.ablationMode: true) first.`);
  process.exit(0);
}

const sites = [...new Set([...mainStats.map((r) => r.site), ...ablationStats.map((r) => r.site)])].sort();

console.log(`React-state analysis vs HTTP-JSON-only ablation, ${sites.length} site(s), from ${args.db}\n`);

console.table(sites.map((site) => {
  const main = mainStats.find((r) => r.site === site);
  const abl = ablationStats.find((r) => r.site === site);
  return {
    site,
    httpEvents: main?.httpEvents ?? abl?.httpEvents ?? 0,
    'candidates (react)': main?.candidatesFound ?? 0,
    'candidates (json)': abl?.candidatesFound ?? 0,
    'requests (react)': main?.requestsGenerated ?? 0,
    'requests (json)': abl?.requestsGenerated ?? 0,
    'flagged (react)': main?.vulnerabilitiesFlagged ?? 0,
    'flagged (json)': abl?.vulnerabilitiesFlagged ?? 0,
  };
}));

const totalReact = mainStats.reduce((s, r) => s + r.vulnerabilitiesFlagged, 0);
const totalJson = ablationStats.reduce((s, r) => s + r.vulnerabilitiesFlagged, 0);
const pct = totalReact > 0 ? Math.round((totalJson / totalReact) * 100) : null;
console.log(`\nTotal flagged — React-state: ${totalReact}, JSON-only ablation: ${totalJson}` +
  (pct !== null ? ` (ablation found ${pct}% of what the full pipeline found)` : ''));

// Per-finding comparison: candidate_url identifies the same underlying request across both tables
// (same site, same splice-the-id-in target), so set membership tells us exactly which findings each
// approach caught that the other didn't — more informative than the totals alone.
interface Finding { site: string; candidateUrl: string }
const mainFindings = (db.prepare('SELECT site, candidate_url AS candidateUrl, detection_method AS detectionMethod FROM vulnerabilities').all() as
  (Finding & { detectionMethod: string })[]);
const ablationFindings = (db.prepare('SELECT site, candidate_url AS candidateUrl FROM ablation_vulnerabilities').all() as Finding[]);

const key = (f: Finding) => `${f.site}|${f.candidateUrl}`;
const ablationSet = new Set(ablationFindings.map(key));
const mainSet = new Set(mainFindings.map(key));

const missedByAblation = mainFindings.filter((f) => !ablationSet.has(key(f)));
if (missedByAblation.length > 0) {
  console.log(`\n${missedByAblation.length} finding(s) the React-state analysis caught that the JSON-only ablation missed entirely:`);
  console.table(missedByAblation.map((f) => ({ site: f.site, candidate: f.candidateUrl, detectionMethod: f.detectionMethod })));
  const byMethod = missedByAblation.reduce<Record<string, number>>((acc, f) => {
    acc[f.detectionMethod] = (acc[f.detectionMethod] ?? 0) + 1;
    return acc;
  }, {});
  console.log('Missed, by detection method — "client-routing" ones are exactly what a JSON-only ' +
    'analysis structurally cannot see at all (no HTTP request carries the value to match against):', byMethod);
}

const onlyAblation = ablationFindings.filter((f) => !mainSet.has(key(f)));
if (onlyAblation.length > 0) {
  console.log(`\n${onlyAblation.length} finding(s) the JSON-only ablation caught that the React-state analysis did NOT — worth a` +
    ' second look, since the main pipeline is expected to be a superset:');
  console.table(onlyAblation);
}
