/**
 * Esplora i primi N siti della lista Tranco (https://tranco-list.eu).
 *
 *   npm run tranco -- --top 10 --depth 2 --max-states 30 --max-duration 300 --concurrency 2
 *   npm run tranco -- --list-id PYK6J      # lista fissa, per esecuzioni riproducibili
 */
import { parseArgs } from 'node:util';
import { KeyValueStore, log } from 'crawlee';
import { runCrawler } from '../src/main';
import { config, type CrawlConfig } from '../src/config';
import { collect } from '../src/stats/aggregate';
import { SITES_DIR } from '../src/state/output/FileOutput';

const TRANCO = 'https://tranco-list.eu';

const { values: args } = parseArgs({
  options: {
    top: { type: 'string', default: '10' },
    'list-id': { type: 'string' },
    depth: { type: 'string', default: '2' },
    'max-states': { type: 'string', default: '30' },
    'max-duration': { type: 'string', default: '300' },
    concurrency: { type: 'string', default: '2' },
  },
});

function positiveInt(name: string, value: string | undefined): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new Error(`--${name} deve essere un intero positivo, non "${value}"`);
  return n;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} ha risposto ${res.status}`);
  return res.text();
}

/** Scarica i primi `top` domini della lista indicata, o dell'ultima disponibile. */
async function fetchTranco(top: number, listId?: string): Promise<{ listId: string; domains: string[] }> {
  const id = listId ?? (await fetchText(`${TRANCO}/top-1m-id`)).trim();
  const csv = await fetchText(`${TRANCO}/download/${id}/${top}`);
  const domains = csv.split('\n')
    .map((line) => line.trim().split(',')[1])   // formato: "rank,dominio"
    .filter((d): d is string => Boolean(d))
    .slice(0, top);
  return { listId: id, domains };
}

const top = positiveInt('top', args.top);
const cfg: CrawlConfig = {
  ...config,
  maxDepth: positiveInt('depth', args.depth),
  maxStates: positiveInt('max-states', args['max-states']),
  maxDurationSecs: positiveInt('max-duration', args['max-duration']),
  concurrency: Math.max(1, positiveInt('concurrency', args.concurrency)),
};

const { listId, domains } = await fetchTranco(top, args['list-id']);
log.info(`Lista Tranco ${listId}: ${domains.join(', ')}`);
log.info(`Limiti per sito: profondità ${cfg.maxDepth}, ${cfg.maxStates} stati, ${cfg.maxDurationSecs}s`);

const stats = await runCrawler(domains.map((d) => `https://${d}/`), cfg);

// riepilogo per sito, salvato anche accanto ai risultati
// cartelle ordinate per nome: per ogni sito l'ultima analisi è quella di questa esecuzione
const statesBySite = new Map<string, number>();
for (const s of (await collect(SITES_DIR)).perSite) statesBySite.set(s.site, s.states);

const summary = {
  listId,
  domains,
  limits: { maxDepth: cfg.maxDepth, maxStates: cfg.maxStates, maxDurationSecs: cfg.maxDurationSecs },
  statesBySite: Object.fromEntries(statesBySite),
  requestsFinished: stats.requestsFinished,
  requestsFailed: stats.requestsFailed,
};
await KeyValueStore.setValue('tranco-summary', summary);

console.table(domains.map((d, i) => ({ rank: i + 1, dominio: d, stati: statesBySite.get(d) ?? 0 })));
console.log(`Completati: ${stats.requestsFinished}, falliti: ${stats.requestsFailed}`);
