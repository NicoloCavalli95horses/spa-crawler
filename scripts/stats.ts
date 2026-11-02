/**
 * Daemon that aggregates the statistics of the analyses in storage/sites/, even while they are running.
 *
 *   npm run stats                        # one pass every 5s, Ctrl+C to stop
 *   npm run stats -- --once              # a single pass, then exit
 *   npm run stats -- --interval 10 --dir storage/sites
 *
 * Writes <dir>/_stats.json and prints a summary.
 */
import { rename, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { collect, type Aggregate } from '../src/stats/aggregate';
import { SITES_DIR } from '../src/state/output/FileOutput';

const { values: args } = parseArgs({
  options: {
    dir: { type: 'string', default: SITES_DIR },
    interval: { type: 'string', default: '5' },
    once: { type: 'boolean', default: false },
  },
});
const dir = args.dir!;
const intervalSecs = Number(args.interval);
if (!(intervalSecs > 0)) throw new Error(`--interval must be > 0, not "${args.interval}"`);

const fmt = (n: number | null) => (n === null ? '-' : String(n));

function print(agg: Aggregate): void {
  console.clear();
  console.log(`[${agg.updatedAt}] ${agg.sites} analyses, ${agg.sitesWithExtension} with extension results`);
  console.table(agg.perSite.map((s) => ({
    site: s.site, started: s.startedAt, states: s.states, edges: s.edges, 'potential IDOR': fmt(s.potentialIdor),
  })));
  console.log(
    `Averages -> states: ${fmt(agg.averages.states)}, edges: ${fmt(agg.averages.edges)}, ` +
    `potential IDOR: ${fmt(agg.averages.potentialIdor)}`,
  );
}

async function tick(): Promise<void> {
  const agg = await collect(dir);
  await mkdir(dir, { recursive: true });
  const out = join(dir, '_stats.json');
  await writeFile(`${out}.tmp`, JSON.stringify(agg, null, 2));
  await rename(`${out}.tmp`, out);
  print(agg);
}

await tick();
if (!args.once) {
  // chained setTimeout: a slow pass never overlaps the next one
  const loop = async (): Promise<void> => {
    await new Promise((r) => setTimeout(r, intervalSecs * 1000));
    await tick().catch((err) => console.error('Pass failed:', (err as Error).message));
    void loop();
  };
  void loop();
}
