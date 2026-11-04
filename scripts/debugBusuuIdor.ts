// Debug/validation script for busuu's IDOR detection — kept around for re-use, NOT committed.
// Uses its OWN sqlite file (never the shared storage/crawler.db) so re-running this never wipes
// real crawl data again.
//
// Phase 1: a tiny real exploration of the dashboard/timeline page (maxStates:2 so at least one
// React-state capture actually happens — beforeAction fires only once `visit()` runs, which needs
// saved < maxStates at the time work() starts).
// Phase 2: a real exploration of the deep exercise URL, same profile, same debug DB (clearOnStart:
// false) so its own React state is added to the SAME preindex phase 1 built. maxStates is high
// enough here that the DFS backtracks and restores (full reload + replay) back to this exact page
// several times — each one a fresh RAPIDOR mount, almost certainly sharing the same structural
// fingerprint as the first capture — which is exactly the case ReactStateStore.record()'s
// keep-the-latest-graph fix (see its own doc comment) exists for. If react_states ends up with
// seen_count > 1 for this URL and the vulnerability is still flagged, the fix held under the
// condition that used to silently lose it.
import os from 'node:os';
import path from 'node:path';
import { runCrawler } from '../src/main';
import { config as defaultConfig, type CrawlConfig } from '../src/config';
import { openDatabase } from '../src/db/openDatabase';
import { VulnerabilityStore } from '../src/db/VulnerabilityStore';
import { AnalysisStatsStore } from '../src/db/AnalysisStatsStore';
import { ReactStateStore } from '../src/db/ReactStateStore';
import { PreindexedValueStore } from '../src/db/PreindexedValueStore';
import { HttpEventStore } from '../src/db/HttpEventStore';
import { CrawlStateStore } from '../src/db/CrawlStateStore';

const DASHBOARD_URL = 'https://www.busuu.com/dashboard/timeline/a1';
const EXERCISE_URL = 'https://www.busuu.com/dashboard/learning/course/start/objective_e43c5b7a-0973-4c44-afbb-5806f509deff/0_0_0_e43c5b7a09734c44afbb5806f509deff/activity_10f55934-23bc-4434-89b6-5c9b3fc3f04a/exercise_1?courseId=course_pack_ja_travel&courseName=Japanese%20for%20Travel&launchType=start';

const DEBUG_DB_PATH = 'storage/debug-busuu.db'; // isolated: never the shared storage/crawler.db

const userDataDir = process.env.USER_DATA_DIR
  ? path.resolve(process.env.USER_DATA_DIR.replace(/^\$HOME|^~/, os.homedir()))
  : path.join(os.homedir(), '.crawler-profile');

async function runPhase({ startUrl, clearOnStart, maxStates, maxDepth }: {
  startUrl: string; clearOnStart: boolean; maxStates: number; maxDepth: number;
}) {
  const cfg: CrawlConfig = {
    ...defaultConfig,
    startUrl, startUrls: [],
    maxDepth, maxStates, concurrency: 1, tabsPerSite: 1,
    headless: false,
    userDataDir,
    db: { ...defaultConfig.db, path: DEBUG_DB_PATH, clearOnStart },
  };
  console.log(`\n=== Phase: ${startUrl} (clearOnStart=${clearOnStart}, maxStates=${maxStates}, maxDepth=${maxDepth}) ===`);
  const stats = await runCrawler([startUrl], cfg);
  console.log('Crawler stats:', stats);
}

await runPhase({ startUrl: DASHBOARD_URL, clearOnStart: true, maxStates: 2, maxDepth: 1 });
// maxStates:8/maxDepth:2 so the DFS actually backtracks through the exercise page (13 clickables)
// more than once via StateNavigator.restore() — each restore is a full reload + replay, so this
// forces several independent RAPIDOR mounts of the exact same URL, the scenario that used to lose
// coverage silently before the ReactStateStore.record() fix.
await runPhase({ startUrl: EXERCISE_URL, clearOnStart: false, maxStates: 8, maxDepth: 2 });

// --- Diagnostics -----------------------------------------------------------------------------
const db = openDatabase({ path: DEBUG_DB_PATH });
const site = new URL(EXERCISE_URL).hostname;

const vulnerabilityStore = new VulnerabilityStore({ db, clearOnStart: false });
const statsStore = new AnalysisStatsStore({ db, clearOnStart: false });
const reactStateStore = new ReactStateStore({ db, clearOnStart: false });
const preindexStore = new PreindexedValueStore({ db, clearOnStart: false });
const httpEventStore = new HttpEventStore({ db, clearOnStart: false });
const crawlStateStore = new CrawlStateStore({ db, clearOnStart: false });

console.log('\n=== analysis_stats ===');
console.log(statsStore.all());

console.log('\n=== crawl_states URLs (ground truth of what was visited) ===');
console.log(crawlStateStore.listBySite(site).map((s) => s.url));

console.log('\n=== react_states: seen_count per URL (>1 means a duplicate-fingerprint remount happened) ===');
console.log(db.prepare('SELECT url, fingerprint, seen_count FROM react_states WHERE site = ?').all(site));

console.log('\n=== http_events count for site ===');
console.log(httpEventStore.listBySite(site).length);

console.log('\n=== preindex matches for the objective_<uuid> segment value ===');
console.log(preindexStore.findByValue('objective_e43c5b7a-0973-4c44-afbb-5806f509deff'));

console.log('\n=== vulnerabilities for site ===');
console.log(JSON.stringify(vulnerabilityStore.count(site)));
console.log(db.prepare('SELECT reference_url, candidate_url, method, motivation FROM vulnerabilities WHERE site = ?').all(site));

process.exit(0);
