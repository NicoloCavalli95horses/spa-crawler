// Read-only inspection of the REAL storage/crawler.db (never cleared, never written to) for busuu's
// objective_<uuid> IDOR candidate. Not committed — ad-hoc diagnostic for the "15+ IDOR not flagged"
// investigation.
import { openDatabase } from '../src/db/openDatabase';
import { PreindexedValueStore } from '../src/db/PreindexedValueStore';
import { ReactStateStore } from '../src/db/ReactStateStore';
import { HttpEventStore } from '../src/db/HttpEventStore';
import { CrawlStateStore } from '../src/db/CrawlStateStore';
import { VulnerabilityStore } from '../src/db/VulnerabilityStore';
import { AnalysisStatsStore } from '../src/db/AnalysisStatsStore';
import { SegmentExtractor } from '../src/analysis/segments';
import { findCandidates } from '../src/analysis/matchFinder';

const DB_PATH = 'storage/crawler.db';
const SITE = 'www.busuu.com';
const TARGET_UUID = 'objective_e43c5b7a-0973-4c44-afbb-5806f509deff';

const db = openDatabase({ path: DB_PATH });

const preindexStore = new PreindexedValueStore({ db, clearOnStart: false });
const reactStateStore = new ReactStateStore({ db, clearOnStart: false });
const httpEventStore = new HttpEventStore({ db, clearOnStart: false });
const crawlStateStore = new CrawlStateStore({ db, clearOnStart: false });
const vulnerabilityStore = new VulnerabilityStore({ db, clearOnStart: false });
const statsStore = new AnalysisStatsStore({ db, clearOnStart: false });

console.log('=== analysis_stats (all sites) ===');
console.log(statsStore.all());

console.log(`\n=== vulnerabilities for ${SITE} ===`);
console.log(JSON.stringify(vulnerabilityStore.count(SITE)));

console.log(`\n=== react_states for ${SITE}: url + seen_count ===`);
const states = db.prepare('SELECT id, url, fingerprint, seen_count FROM react_states WHERE site = ?').all(SITE) as
  { id: number; url: string; fingerprint: string; seen_count: number }[];
console.log(`total: ${states.length}`);
for (const s of states) console.log(`  [${s.id}] seen=${s.seen_count} ${s.url}`);

console.log(`\n=== preindex matches for value "${TARGET_UUID}" ===`);
const matches = preindexStore.findByValue(TARGET_UUID);
console.log(`total matches: ${matches.length}`);
console.log(matches);

console.log(`\n=== for each match: does findCandidates() find sibling instances? ===`);
for (const m of matches) {
  const graph = reactStateStore.getById(m.stateId);
  if (!graph) { console.log(`  stateId=${m.stateId}: NO GRAPH (dangling reference)`); continue; }
  const node = (graph.nodes ?? {})[m.nodeId] as { componentId?: number } | undefined;
  const componentId = node?.componentId;
  const siblings = componentId != null ? (graph.componentIndex ?? {})[String(componentId)] : undefined;
  console.log(`  stateId=${m.stateId} nodeId=${m.nodeId} path=${JSON.stringify(m.path)} componentId=${componentId} siblingCount=${siblings?.length ?? 0}`);
  const candidates = findCandidates({ stateId: m.stateId, graph, nodeId: m.nodeId, path: m.path });
  console.log(`    -> findCandidates: ${candidates.length} candidate(s): ${candidates.map((c) => c.candidateValue).join(', ')}`);
}

console.log(`\n=== crawl_states (ground truth of visited URLs) for ${SITE}, filtered to those containing "objective_" ===`);
const crawled = crawlStateStore.listBySite(SITE).map((s) => s.url).filter((u) => u.includes('objective_'));
console.log(`total objective_ URLs visited: ${crawled.length}`);
for (const u of crawled) console.log(`  ${u}`);

console.log(`\n=== http_events for ${SITE}: how many reference an objective_<uuid> segment ===`);
const events = httpEventStore.listBySite(SITE);
console.log(`total http_events: ${events.length}`);
const withObjective = events.filter((e) => e.url.includes('objective_'));
console.log(`containing "objective_": ${withObjective.length}`);
for (const e of withObjective.slice(0, 20)) console.log(`  ${e.method} ${e.url}`);

console.log(`\n=== SegmentExtractor on the target URL: what segments/candidates would be proposed today ===`);
const extractor = new SegmentExtractor();
const targetPageUrl = crawled.find((u) => u.includes(TARGET_UUID));
if (targetPageUrl) {
  for (const seg of extractor.extract(targetPageUrl)) {
    console.log(`  segment index=${seg.index} value=${seg.value} paramName=${seg.paramName ?? '(path)'}`);
  }
} else {
  console.log('  (no crawled URL contains the target uuid — see crawl_states dump above)');
}

console.log('\n=== SAME check but for the uuid the crawler ACTUALLY visited (6b7d3502) ===');
const VISITED_UUID = 'objective_6b7d3502-08b2-44e0-b10d-575099bb4814';
const visitedMatches = preindexStore.findByValue(VISITED_UUID);
console.log(`matches for ${VISITED_UUID}: ${visitedMatches.length}`);
for (const m of visitedMatches) {
  const graph = reactStateStore.getById(m.stateId);
  if (!graph) continue;
  const node = (graph.nodes ?? {})[m.nodeId] as { componentId?: number } | undefined;
  const siblings = node?.componentId != null ? (graph.componentIndex ?? {})[String(node.componentId)] : undefined;
  console.log(`  stateId=${m.stateId} nodeId=${m.nodeId} path=${JSON.stringify(m.path)} componentId=${node?.componentId} siblingCount=${siblings?.length ?? 0}`);
}

console.log('\n=== for each 6b7d3502 match-state, is node-232 (e43c5b7a) among its own componentIndex siblings? ===');
for (const m of visitedMatches) {
  const graph = reactStateStore.getById(m.stateId);
  if (!graph) continue;
  const node = (graph.nodes ?? {})[m.nodeId] as { componentId?: number } | undefined;
  const siblings = node?.componentId != null ? (graph.componentIndex ?? {})[String(node.componentId)] : undefined;
  const hasTargetNode = siblings?.includes('node-232') ?? false;
  const targetNodeProps = hasTargetNode ? (graph.nodes ?? {})['node-232'] : undefined;
  console.log(`  stateId=${m.stateId}: siblings include node-232? ${hasTargetNode}` + (targetNodeProps ? ` (key=${(targetNodeProps as any).key})` : ''));
}

console.log('\n=== which stateIds exist per uuid (do 6b7d3502 and e43c5b7a ever share a stateId)? ===');
console.log('e43c5b7a stateIds:', [...new Set(matches.map((m) => m.stateId))]);
console.log('6b7d3502 stateIds:', [...new Set(visitedMatches.map((m) => m.stateId))]);


console.log('\n=== crawl_states for dashboard/timeline: clickable count + any selector mentioning objective/course ===');
const allCrawled = crawlStateStore.listBySite(SITE);
const timelineStates = allCrawled.filter((s) => s.url.includes('dashboard/timeline'));
console.log(`timeline states: ${timelineStates.length}`);
for (const s of timelineStates) {
  const clickables = s.clickables as { selector: string; text?: string }[];
  const objectiveLike = clickables.filter((c) => /objective|course|lesson|unit/i.test(c.selector) || /objective|course|lesson|unit/i.test(c.text ?? ''));
  console.log(`  state ${s.id} depth=${s.depth}: ${clickables.length} clickables total, ${objectiveLike.length} objective/course-like`);
  for (const c of objectiveLike.slice(0, 5)) console.log(`    ${c.selector} | text="${c.text}"`);
}


console.log('\n=== ALL clickable texts for ONE representative dashboard/timeline state (depth=0, root) ===');
const rootTimeline = timelineStates.find((s) => s.depth === 0) ?? timelineStates[0];
if (rootTimeline) {
  const clickables = rootTimeline.clickables as { selector: string; text?: string }[];
  clickables.forEach((c, i) => console.log(`  [${i}] "${(c.text ?? '').slice(0, 80)}"`));
}

process.exit(0);
