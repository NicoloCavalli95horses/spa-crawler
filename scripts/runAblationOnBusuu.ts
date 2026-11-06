// Runs AblationPipeline against the REAL storage/crawler.db's already-captured busuu http_events/
// crawl_states (never cleared, no new exploration) — only ever writes to ablation_stats/
// ablation_vulnerabilities, never touches vulnerabilities/analysis_stats/react_states/etc. Not
// committed — ad-hoc test run for the ablation feature, requested directly against the live data.
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { log, LogLevel } from 'crawlee';
log.setLevel(LogLevel.DEBUG);
import { openDatabase } from '../src/db/openDatabase';
import { HttpEventStore } from '../src/db/HttpEventStore';
import { CrawlStateStore } from '../src/db/CrawlStateStore';
import { AblationVulnerabilityStore } from '../src/db/AblationVulnerabilityStore';
import { AblationStatsStore } from '../src/db/AblationStatsStore';
import { ForgedRequestStore } from '../src/db/ForgedRequestStore';
import { AuthzClassificationStore } from '../src/db/AuthzClassificationStore';
import { AuthzClassifier } from '../src/analysis/authzClassifier';
import { AblationPipeline } from '../src/analysis/AblationPipeline';
import { config } from '../src/config';

const DB_PATH = 'storage/crawler.db';
const SITE = 'www.busuu.com';

const userDataDir = process.env.USER_DATA_DIR
  ? path.resolve(process.env.USER_DATA_DIR.replace(/^\$HOME|^~/, os.homedir()))
  : path.join(os.homedir(), '.crawler-profile');

const db = openDatabase({ path: DB_PATH }); // clearOnStart:false everywhere below — nothing existing is touched
const httpEventStore = new HttpEventStore({ db, clearOnStart: false });
const crawlStateStore = new CrawlStateStore({ db, clearOnStart: false });
const vulnerabilityStore = new AblationVulnerabilityStore({ db, clearOnStart: false });
const statsStore = new AblationStatsStore({ db, clearOnStart: false });
// shared with the main pipeline's own prior runs against this same db: if AnalysisPipeline already
// forged a candidate this run also proposes, it's reused instead of hit again live — see
// ForgedRequestStore's own doc comment.
const forgedRequestStore = new ForgedRequestStore({ db, clearOnStart: false });
const classifier = new AuthzClassifier(new AuthzClassificationStore({ db, clearOnStart: false }));

const pipeline = new AblationPipeline({
  httpEventStore, crawlStateStore, vulnerabilityStore, statsStore, forgedRequestStore, classifier,
  options: { maxConcurrentRequests: config.analysis.maxConcurrentRequests, timeBetweenRequestsMs: config.analysis.timeBetweenRequestsMs },
});

const context = await chromium.launchPersistentContext(userDataDir, { headless: true, channel: 'chromium' });
const page = context.pages()[0] ?? (await context.newPage());

console.log(`Running AblationPipeline for ${SITE} against ${DB_PATH} (real, already-captured http_events — no new exploration)...`);
await pipeline.runForSite({ page, site: SITE });

console.log('\n=== ablation_stats ===');
console.log(statsStore.all());
console.log('\n=== ablation_vulnerabilities count ===', vulnerabilityStore.count(SITE));

await context.close();
process.exit(0);
