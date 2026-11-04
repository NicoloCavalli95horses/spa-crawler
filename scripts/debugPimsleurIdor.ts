// Debug/validation script for pimsleur.com's IDOR detection (headless vs headful) — not committed.
// Runs ONE phase per process invocation (see the bottom of this file): Crawlee's local request-queue
// storage persists across runCrawler() calls within the same Node process (its purgeOnStart only
// purges once per process), so calling this twice in one process for the SAME URL would make the
// second call see "0 requests" regardless of headless — a test-harness artifact, not a real
// headless-vs-headful difference. Running each phase as its own process sidesteps that entirely,
// and also matches how a user actually invokes the crawler (`npm start`, once per run).
//
// Usage: HEADLESS=true npx tsx scripts/debugPimsleurIdor.ts
//        HEADLESS=false npx tsx scripts/debugPimsleurIdor.ts
import os from 'node:os';
import path from 'node:path';
import { rmSync } from 'node:fs';
import { runCrawler } from '../src/main';
import { config as defaultConfig, type CrawlConfig } from '../src/config';
import { openDatabase } from '../src/db/openDatabase';
import { VulnerabilityStore } from '../src/db/VulnerabilityStore';
import { AnalysisStatsStore } from '../src/db/AnalysisStatsStore';
import { ReactStateStore } from '../src/db/ReactStateStore';
import { PreindexedValueStore } from '../src/db/PreindexedValueStore';
import { HttpEventStore } from '../src/db/HttpEventStore';
import { CrawlStateStore } from '../src/db/CrawlStateStore';

const START_URL = 'https://learn.pimsleur.com/MiniLearn';
const headless = process.env.HEADLESS !== 'false'; // defaults true, same convention as src/config.ts
const DEBUG_DB_PATH = `storage/debug-pimsleur-${headless ? 'headless' : 'headful'}.db`; // isolated: never the shared storage/crawler.db, and one file per mode so a side-by-side read-back never mixes the two
// Crawlee's own local request-queue/key-value-store storage (not the SQLite db above) is shared by
// default (./storage/{request_queues,key_value_stores}); wipe it before this process's single run so
// a previous invocation (headful or headless) never makes this one see the URL as already handled.
rmSync('storage/request_queues', { recursive: true, force: true });
rmSync('storage/key_value_stores', { recursive: true, force: true });

const userDataDir = process.env.USER_DATA_DIR
  ? path.resolve(process.env.USER_DATA_DIR.replace(/^\$HOME|^~/, os.homedir()))
  : path.join(os.homedir(), '.crawler-profile');

const cfg: CrawlConfig = {
  ...defaultConfig,
  startUrl: START_URL, startUrls: [],
  maxDepth: 3, maxStates: 25, concurrency: 1, tabsPerSite: 1,
  headless,
  userDataDir,
  db: { ...defaultConfig.db, path: DEBUG_DB_PATH, clearOnStart: true },
};

console.log(`\n=== headless=${headless} (maxStates=${cfg.maxStates}, maxDepth=${cfg.maxDepth}) ===`);
const stats = await runCrawler([START_URL], cfg);
console.log('Crawler stats:', stats);

const db = openDatabase({ path: DEBUG_DB_PATH });
const site = new URL(START_URL).hostname;
const vulnerabilityStore = new VulnerabilityStore({ db, clearOnStart: false });
const statsStore = new AnalysisStatsStore({ db, clearOnStart: false });
const reactStateStore = new ReactStateStore({ db, clearOnStart: false });
const preindexStore = new PreindexedValueStore({ db, clearOnStart: false });
const httpEventStore = new HttpEventStore({ db, clearOnStart: false });
const crawlStateStore = new CrawlStateStore({ db, clearOnStart: false });

console.log(`--- diagnostics (headless=${headless}) ---`);
console.log('analysis_stats:', statsStore.all());
console.log('crawl_states URLs:', crawlStateStore.listBySite(site).map((s) => s.url));
console.log('react_states URLs:', reactStateStore.listUrlsBySite(site));
console.log('http_events count:', httpEventStore.listBySite(site).length);
console.log('preindexed_values count:', preindexStore.count());
console.log('vulnerabilities count:', vulnerabilityStore.count(site));
console.log(db.prepare('SELECT reference_url, candidate_url, method, motivation FROM vulnerabilities WHERE site = ?').all(site));

process.exit(0);
