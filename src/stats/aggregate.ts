import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * RAPIDOR counters summed across a site's tabs: our field -> key in the extension's `stats`.
 * Each tab keeps its own counters, so the site total is their sum.
 */
const SUMMED = {
  reactStatesSaved: 'States saved',
  reactStatesSkipped: 'States skipped (duplicate)',
  httpEventsTracked: 'HTTP events tracked (in scope)',
  httpEventsSaved: 'HTTP events saved',
  httpEventsAnalyzed: 'HTTP events analyzed',
  navigationEvents: 'Navigation events',
  preindexedValues: 'Preindexed values extracted',
  matchesFound: 'Preindexed matches found',
  candidatesFound: 'Candidate instances found',
  requestsGenerated: 'HTTP requests generated',
  requestsSkipped: 'Requests skipped (duplicate)',
  responseEvaluations: 'Response evaluations performed',
  propDifferences: 'Prop differences found',
} as const;

/** RAPIDOR metrics that are already a maximum: the site value is the max across tabs. */
const MAXED = {
  maxComponents: 'Max components seen in a snapshot',
} as const;

/** Array of report payloads (`{ id, reference, current, analysis, ... }`), or 0 when there are none. */
export const VULNERABILITY_FIELD = 'Vulnerability report';
/** Array of distinct key names, or 0 when there are none. */
export const SENSITIVE_KEYS_FIELD = 'Sensitive (authZ-relevant) keys detected';

export type ExtensionNumbers = Record<
  keyof typeof SUMMED | keyof typeof MAXED | 'vulnerabilities' | 'sensitiveKeys', number
>;

/** Numeric extension fields, in display order: the ones averaged and summed over the sites. */
export const EXTENSION_FIELDS = [
  'vulnerabilities', 'sensitiveKeys', ...Object.keys(SUMMED), ...Object.keys(MAXED),
] as (keyof ExtensionNumbers)[];

export interface ExtensionStats extends ExtensionNumbers {
  tabs: number;                  // tabs that answered the extension call
  vulnerabilityIds: string[];    // distinct report ids: details are in the site's extension-end-*.json
  sensitiveKeyNames: string[];
}

export interface SiteStats {
  site: string;
  folder: string;
  startedAt: string;              // from the folder name, e.g. 2026-10-30T12-16-20
  states: number;
  edges: number;
  extension: ExtensionStats | null;   // null: the extension has not responded (yet)
}

type Numbers = Record<'states' | 'edges' | keyof ExtensionNumbers, number>;

export interface Aggregate {
  updatedAt: string;
  sites: number;
  sitesWithExtension: number;
  sitesWithVulnerabilities: number;
  // states and edges over all sites; extension fields only over the sites with extension results
  totals: Numbers;
  averages: Record<keyof Numbers, number | null>;
  perSite: SiteStats[];
}

/** Reads a JSON file; null if missing or unreadable (it may be mid-write: retry on the next pass). */
async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

/** `google.com_2026-10-30T12-16-20` -> site and timestamp; undefined if the name does not have the expected shape. */
export function parseFolder(name: string): { site: string; startedAt: string } | undefined {
  const m = /^(.+)_(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})$/.exec(name);
  return m ? { site: m[1]!, startedAt: m[2]! } : undefined;
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/**
 * Merges the `__RAPIDOR__getData` result of a site: one `{ tabId, logs, stats }` entry per tab
 * (a single `{ logs, stats }` object is accepted too). Null if there is nothing to read.
 */
export function extensionStats({ data }: { data: unknown }): ExtensionStats | null {
  const entries = Array.isArray(data) ? data : data && typeof data === 'object' ? [data] : [];
  const tabs = entries
    .map((e) => (e as { stats?: unknown } | null)?.stats)
    .filter((s): s is Record<string, unknown> => Boolean(s) && typeof s === 'object');
  if (tabs.length === 0) return null;

  const counters = Object.fromEntries([
    ...Object.entries(SUMMED).map(([field, key]) => [field, tabs.reduce((n, s) => n + num(s[key]), 0)]),
    ...Object.entries(MAXED).map(([field, key]) => [field, Math.max(...tabs.map((s) => num(s[key])))]),
  ]) as Record<keyof typeof SUMMED | keyof typeof MAXED, number>;

  // tabs share the site's context and may report the same item: count each id once
  const vulnerabilityIds = [...new Set(tabs.flatMap((s) => list(s[VULNERABILITY_FIELD])
    .map((r) => (r as { id?: unknown } | null)?.id)
    .filter((id) => id !== undefined && id !== null)
    .map(String)))];
  const sensitiveKeyNames = [...new Set(tabs.flatMap((s) => list(s[SENSITIVE_KEYS_FIELD]).map(String)))].sort();

  return {
    tabs: tabs.length,
    vulnerabilities: vulnerabilityIds.length,
    sensitiveKeys: sensitiveKeyNames.length,
    ...counters,
    vulnerabilityIds,
    sensitiveKeyNames,
  };
}

export async function readSiteStats(root: string, folder: string): Promise<SiteStats | undefined> {
  const parsed = parseFolder(folder);
  if (!parsed) return undefined;
  const dir = join(root, folder);

  const states = await readJson(join(dir, 'states.json'));
  const graph = await readJson(join(dir, 'state-graph.json')) as { edges?: unknown[] } | null;

  const files = await readdir(dir);
  const extFile = files.find((f) => /^extension-end-.*getData\.json$/.test(f));
  const extension = extFile ? extensionStats({ data: await readJson(join(dir, extFile)) }) : null;

  return {
    ...parsed,
    folder,
    states: Array.isArray(states) ? states.length : 0,
    edges: graph?.edges?.length ?? 0,
    extension,
  };
}

const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);
const mean = (xs: number[]): number | null =>
  xs.length ? Math.round((sum(xs) / xs.length) * 100) / 100 : null;

export function aggregate(perSite: SiteStats[], now = new Date()): Aggregate {
  const ext = perSite.flatMap((s) => (s.extension ? [s.extension] : []));
  const columns: [keyof Numbers, number[]][] = [
    ['states', perSite.map((s) => s.states)],
    ['edges', perSite.map((s) => s.edges)],
    ...EXTENSION_FIELDS.map((f): [keyof Numbers, number[]] => [f, ext.map((e) => e[f])]),
  ];
  return {
    updatedAt: now.toISOString(),
    sites: perSite.length,
    sitesWithExtension: ext.length,
    sitesWithVulnerabilities: ext.filter((e) => e.vulnerabilities > 0).length,
    totals: Object.fromEntries(columns.map(([k, xs]) => [k, sum(xs)])) as Aggregate['totals'],
    averages: Object.fromEntries(columns.map(([k, xs]) => [k, mean(xs)])) as Aggregate['averages'],
    perSite,
  };
}

/** Scans all the `<site>_<timestamp>` folders in `root`, including those still running. */
export async function collect(root: string): Promise<Aggregate> {
  let folders: string[] = [];
  try {
    folders = (await readdir(root, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    // no analyses yet: empty statistics
  }
  const all = await Promise.all(folders.sort().map((f) => readSiteStats(root, f).catch(() => undefined)));
  return aggregate(all.filter((s): s is SiteStats => s !== undefined));
}
