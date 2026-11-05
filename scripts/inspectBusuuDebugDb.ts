// Read-only inspection of storage/debug-busuu.db (debugBusuuIdor.ts's own isolated db). Not committed.
import { openDatabase } from '../src/db/openDatabase';
import { PreindexedValueStore } from '../src/db/PreindexedValueStore';
import { ReactStateStore } from '../src/db/ReactStateStore';
import { HttpEventStore } from '../src/db/HttpEventStore';
import { CrawlStateStore } from '../src/db/CrawlStateStore';
import { VulnerabilityStore } from '../src/db/VulnerabilityStore';
import { AnalysisStatsStore } from '../src/db/AnalysisStatsStore';
import { findCandidates } from '../src/analysis/matchFinder';

const DB_PATH = 'storage/debug-busuu.db';
const SITE = 'www.busuu.com';
const TARGET_UUID = 'objective_e43c5b7a-0973-4c44-afbb-5806f509deff';

const db = openDatabase({ path: DB_PATH });
const preindexStore = new PreindexedValueStore({ db, clearOnStart: false });
const reactStateStore = new ReactStateStore({ db, clearOnStart: false });
const httpEventStore = new HttpEventStore({ db, clearOnStart: false });
const crawlStateStore = new CrawlStateStore({ db, clearOnStart: false });
const vulnerabilityStore = new VulnerabilityStore({ db, clearOnStart: false });
const statsStore = new AnalysisStatsStore({ db, clearOnStart: false });

console.log('=== analysis_stats ===');
console.log(statsStore.all());
console.log('\n=== vulnerabilities count ===', vulnerabilityStore.count(SITE));

console.log('\n=== crawl_states containing the target uuid (was it ever actually visited?) ===');
const crawled = crawlStateStore.listBySite(SITE).map((s) => s.url).filter((u) => u.includes(TARGET_UUID));
console.log(crawled);

console.log('\n=== http_events containing the target uuid ===');
const events = httpEventStore.listBySite(SITE);
console.log(events.filter((e) => e.url.includes(TARGET_UUID)).map((e) => `${e.method} ${e.url}`));

console.log('\n=== preindex matches for target uuid + findCandidates ===');
const matches = preindexStore.findByValue(TARGET_UUID);
console.log(`matches: ${matches.length}`);
for (const m of matches) {
  const graph = reactStateStore.getById(m.stateId);
  if (!graph) { console.log(`  stateId=${m.stateId}: no graph`); continue; }
  const node = (graph.nodes ?? {})[m.nodeId] as { componentId?: number } | undefined;
  const siblings = node?.componentId != null ? (graph.componentIndex ?? {})[String(node.componentId)] : undefined;
  const candidates = findCandidates({ stateId: m.stateId, graph, nodeId: m.nodeId, path: m.path });
  console.log(`  stateId=${m.stateId} nodeId=${m.nodeId} path=${JSON.stringify(m.path)} componentId=${node?.componentId} siblings=${siblings?.length ?? 0} candidates=${candidates.length}`);
}

console.log('\n=== all react_states captured (url + seen_count) ===');
const states = db.prepare('SELECT id, url, seen_count FROM react_states WHERE site = ?').all(SITE) as { id: number; url: string; seen_count: number }[];
for (const s of states) console.log(`  [${s.id}] seen=${s.seen_count} ${s.url}`);


console.log('\n=== ALL vulnerabilities for the site (full rows) ===');
const rows = db.prepare('SELECT id, reference_url, candidate_url, method, detection_method, motivation FROM vulnerabilities WHERE site = ?').all(SITE);
console.log(`total: ${(rows as any[]).length}`);
for (const r of rows as any[]) {
  console.log(`\n  [${r.detection_method}] ${r.method}`);
  console.log(`    ref: ${r.reference_url}`);
  console.log(`    cand: ${r.candidate_url}`);
  console.log(`    motivation: ${r.motivation.slice(0, 200)}`);
}

console.log('\n=== vulnerabilities whose candidate_url contains the target uuid ===');
const targetRows = (rows as any[]).filter((r) => r.candidate_url.includes(TARGET_UUID) || r.reference_url.includes(TARGET_UUID));
console.log(`matching rows: ${targetRows.length}`);

process.exit(0);
