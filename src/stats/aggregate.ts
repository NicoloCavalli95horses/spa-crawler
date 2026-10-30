import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Campo del JSON dell'estensione (`stats`) che interessa per ora. */
export const IDOR_FIELD = 'Potential IDOR reported';

export interface SiteStats {
  site: string;
  folder: string;
  startedAt: string;            // dal nome della cartella, es. 2026-10-30T12-16-20
  states: number;
  edges: number;
  potentialIdor: number | null; // null: l'estensione non ha (ancora) risposto
}

export interface Aggregate {
  updatedAt: string;
  sites: number;
  sitesWithExtension: number;
  averages: {
    states: number | null;
    edges: number | null;
    potentialIdor: number | null;   // solo sui siti con risultati dell'estensione
  };
  perSite: SiteStats[];
}

/** Legge un JSON; null se manca o è illeggibile (può essere in scrittura: si riprova al giro dopo). */
async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

/** `google.com_2026-10-30T12-16-20` -> sito e timestamp; undefined se il nome non ha la forma attesa. */
export function parseFolder(name: string): { site: string; startedAt: string } | undefined {
  const m = /^(.+)_(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})$/.exec(name);
  return m ? { site: m[1]!, startedAt: m[2]! } : undefined;
}

export async function readSiteStats(root: string, folder: string): Promise<SiteStats | undefined> {
  const parsed = parseFolder(folder);
  if (!parsed) return undefined;
  const dir = join(root, folder);

  const states = await readJson(join(dir, 'states.json'));
  const graph = await readJson(join(dir, 'state-graph.json')) as { edges?: unknown[] } | null;

  let potentialIdor: number | null = null;
  const files = await readdir(dir);
  const extFile = files.find((f) => /^extension-end-.*getData\.json$/.test(f));
  if (extFile) {
    const ext = await readJson(join(dir, extFile)) as { stats?: Record<string, unknown> } | null;
    const v = ext?.stats?.[IDOR_FIELD];
    if (typeof v === 'number') potentialIdor = v;
  }

  return {
    ...parsed,
    folder,
    states: Array.isArray(states) ? states.length : 0,
    edges: graph?.edges?.length ?? 0,
    potentialIdor,
  };
}

const mean = (xs: number[]): number | null =>
  xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : null;

export function aggregate(perSite: SiteStats[], now = new Date()): Aggregate {
  const idor = perSite.flatMap((s) => (s.potentialIdor === null ? [] : [s.potentialIdor]));
  return {
    updatedAt: now.toISOString(),
    sites: perSite.length,
    sitesWithExtension: idor.length,
    averages: {
      states: mean(perSite.map((s) => s.states)),
      edges: mean(perSite.map((s) => s.edges)),
      potentialIdor: mean(idor),
    },
    perSite,
  };
}

/** Scansiona tutte le cartelle `<sito>_<timestamp>` di `root`, anche quelle ancora in corso. */
export async function collect(root: string): Promise<Aggregate> {
  let folders: string[] = [];
  try {
    folders = (await readdir(root, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    // nessuna analisi ancora: statistiche vuote
  }
  const all = await Promise.all(folders.sort().map((f) => readSiteStats(root, f).catch(() => undefined)));
  return aggregate(all.filter((s): s is SiteStats => s !== undefined));
}
