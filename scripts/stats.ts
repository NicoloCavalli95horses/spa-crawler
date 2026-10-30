/**
 * Daemon che aggrega le statistiche delle analisi in storage/sites/, anche mentre sono in corso.
 *
 *   npm run stats                        # un giro ogni 5s, Ctrl+C per fermarlo
 *   npm run stats -- --once              # un solo giro ed esce
 *   npm run stats -- --interval 10 --dir storage/sites
 *
 * Scrive <dir>/_stats.json e stampa un riepilogo.
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
if (!(intervalSecs > 0)) throw new Error(`--interval deve essere > 0, non "${args.interval}"`);

const fmt = (n: number | null) => (n === null ? '-' : String(n));

function print(agg: Aggregate): void {
  console.clear();
  console.log(`[${agg.updatedAt}] ${agg.sites} analisi, ${agg.sitesWithExtension} con risultati dell'estensione`);
  console.table(agg.perSite.map((s) => ({
    sito: s.site, avvio: s.startedAt, stati: s.states, archi: s.edges, 'potential IDOR': fmt(s.potentialIdor),
  })));
  console.log(
    `Medie -> stati: ${fmt(agg.averages.states)}, archi: ${fmt(agg.averages.edges)}, ` +
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
  // setTimeout a catena: un giro lento non si sovrappone al successivo
  const loop = async (): Promise<void> => {
    await new Promise((r) => setTimeout(r, intervalSecs * 1000));
    await tick().catch((err) => console.error('Giro non riuscito:', (err as Error).message));
    void loop();
  };
  void loop();
}
