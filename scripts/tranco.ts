/**
 * Explores N sites of the Tranco list (https://tranco-list.eu), starting from rank P (default 1).
 *
 *   npm run tranco -- --top 10 --depth 2 --max-states 30 --max-duration 300 --concurrency 2 --tabs 3
 *   npm run tranco -- --start 50 --top 5   # ranks 50..54
 *   npm run tranco -- --list-id PYK6J      # fixed list, for reproducible runs
 */
import { parseArgs } from 'node:util';
import { KeyValueStore, log } from 'crawlee';
import { runCrawler } from '../src/main';
import { config, type CrawlConfig } from '../src/config';
import { openDatabase } from '../src/db/openDatabase';
import { CrawlStateStore } from '../src/db/CrawlStateStore';
import { VulnerabilityStore } from '../src/db/VulnerabilityStore';

const TRANCO = 'https://tranco-list.eu';

const { values: args } = parseArgs({
  options: {
    top: { type: 'string', default: '10' },
    start: { type: 'string', default: '1' },
    'list-id': { type: 'string' },
    depth: { type: 'string', default: '2' },
    'max-states': { type: 'string', default: '30' },
    'max-duration': { type: 'string', default: '300' },
    concurrency: { type: 'string', default: '2' },
    tabs: { type: 'string', default: '1' },
  },
});

function intArg({ name, value, min = 0 }: { name: string; value: string | undefined; min?: number }): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min) throw new Error(`--${name} must be an integer >= ${min}, not "${value}"`);
  return n;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} responded ${res.status}`);
  return res.text();
}

interface TrancoEntry { rank: number; domain: string }

/** Downloads `count` domains starting from rank `start` of the given list, or of the latest available one. */
async function fetchTranco(
  { start, count, listId }: { start: number; count: number; listId?: string },
): Promise<{ listId: string; entries: TrancoEntry[] }> {
  const id = listId ?? (await fetchText(`${TRANCO}/top-1m-id`)).trim();
  // the API only serves the top N: download up to the last requested rank and drop the ones before `start`
  const csv = await fetchText(`${TRANCO}/download/${id}/${start + count - 1}`);
  const entries = csv.split('\n')
    .map((line) => line.trim().split(','))   // format: "rank,domain"
    .map(([rank, domain]) => ({ rank: Number(rank), domain }))
    .filter((e): e is TrancoEntry => Boolean(e.domain) && e.rank >= start)
    .slice(0, count);
  return { listId: id, entries };
}

const start = intArg({ name: 'start', value: args.start, min: 1 });
const top = intArg({ name: 'top', value: args.top, min: 1 });
const cfg: CrawlConfig = {
  ...config,
  maxDepth: intArg({ name: 'depth', value: args.depth }),
  maxStates: intArg({ name: 'max-states', value: args['max-states'] }),
  maxDurationSecs: intArg({ name: 'max-duration', value: args['max-duration'] }),
  concurrency: intArg({ name: 'concurrency', value: args.concurrency, min: 1 }),
  tabsPerSite: intArg({ name: 'tabs', value: args.tabs, min: 1 }),
};

const { listId, entries } = await fetchTranco({ start, count: top, listId: args['list-id'] });
const domains = entries.map((e) => e.domain);
log.info(`Tranco list ${listId}, ranks ${start}-${start + entries.length - 1}: ${domains.join(', ')}`);
log.info(`Per-site limits: depth ${cfg.maxDepth}, ${cfg.maxStates} states, ${cfg.maxDurationSecs}s`);

const stats = await runCrawler(entries.map((e, i) => ({
  url: `https://${e.domain}/`,
  // shown in front of the site logs: position in this run and Tranco rank
  userData: { progress: `[${i + 1}/${entries.length}] #${e.rank}` },
})), cfg);

// per-site summary, also saved next to the results — read straight from the same SQLite file every
// store in this run just wrote into (see src/db/)
const db = openDatabase({ path: cfg.db.path });
const crawlStates = new CrawlStateStore({ db, clearOnStart: false });
const vulnerabilityStore = new VulnerabilityStore({ db, clearOnStart: false });

const summary = {
  listId,
  start,
  domains,
  limits: { maxDepth: cfg.maxDepth, maxStates: cfg.maxStates, maxDurationSecs: cfg.maxDurationSecs },
  statesBySite: Object.fromEntries(domains.map((d) => [d, crawlStates.count(d)])),
  vulnerabilitiesBySite: Object.fromEntries(domains.map((d) => [d, vulnerabilityStore.count(d)])),
  requestsFinished: stats.requestsFinished,
  requestsFailed: stats.requestsFailed,
};
await KeyValueStore.setValue('tranco-summary', summary);

console.table(entries.map((e) => ({
  rank: e.rank, domain: e.domain,
  states: crawlStates.count(e.domain),
  vulnerabilities: vulnerabilityStore.count(e.domain),
})));
console.log(`Finished: ${stats.requestsFinished}, failed: ${stats.requestsFailed}`);
