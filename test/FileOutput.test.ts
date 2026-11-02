import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileOutput, folderTimestamp } from '../src/state/output/FileOutput';
import { aggregate, collect, extensionStats, parseFolder } from '../src/stats/aggregate';
import type { StateRecord } from '../src/core/types';

const record = (id: string): StateRecord => ({ id, url: `https://a.test/${id}`, depth: 0, path: [], clickables: [], texts: ['è'] });

let root: string;
before(async () => { root = await mkdtemp(join(tmpdir(), 'crawler-test-')); });
after(async () => { await rm(root, { recursive: true, force: true }); });

describe('FileOutput', () => {
  it('creates the <site>_<timestamp> folder', () => {
    const out = new FileOutput('a.test', root, new Date('2026-10-30T12:16:20.701Z'));
    assert.equal(out.dir, join(root, 'a.test_2026-10-30T12-16-20'));
    assert.equal(folderTimestamp(new Date('2026-01-02T03:04:05Z')), '2026-01-02T03-04-05');
  });

  it('states.json stays a valid JSON array after each state', async () => {
    const out = new FileOutput('a.test', root, new Date('2026-10-30T10:00:00Z'));
    for (const id of ['s0', 's1', 's2']) {
      await out.saveState(record(id));
      const parsed = JSON.parse(await readFile(join(out.dir, 'states.json'), 'utf8'));
      assert.equal(parsed.at(-1).id, id);
    }
    assert.deepEqual(JSON.parse(await readFile(join(out.dir, 'states.json'), 'utf8')).map((s: StateRecord) => s.id), ['s0', 's1', 's2']);
  });

  it('concurrent writes do not interleave', async () => {
    const out = new FileOutput('b.test', root, new Date('2026-10-30T10:00:00Z'));
    await Promise.all(['x', 'y', 'z', 'w'].map((id) => out.saveState(record(id))));
    assert.equal(JSON.parse(await readFile(join(out.dir, 'states.json'), 'utf8')).length, 4);
  });

  it('saveJson rewrites the file and leaves no temporary files', async () => {
    const out = new FileOutput('c.test', root, new Date('2026-10-30T10:00:00Z'));
    await out.saveJson('state-graph', { edges: [1] });
    await out.saveJson('state-graph', { edges: [1, 2] });
    assert.deepEqual(JSON.parse(await readFile(join(out.dir, 'state-graph.json'), 'utf8')), { edges: [1, 2] });
    assert.deepEqual(await readdir(out.dir), ['state-graph.json']);
  });
});

describe('aggregate', () => {
  it('parseFolder', () => {
    assert.deepEqual(parseFolder('www.a.com_2026-10-30T12-16-20'), { site: 'www.a.com', startedAt: '2026-10-30T12-16-20' });
    assert.equal(parseFolder('_stats.json'), undefined);
  });

  it('extensionStats merges the tabs: sums counters, max of maxima, distinct reports and keys', () => {
    const e = extensionStats({ data: [
      { tabId: 1, logs: [], stats: { 'States saved': 3, 'HTTP events tracked (in scope)': 10, 'Max components seen in a snapshot': 40,
        'Vulnerability report': [{ id: 'v1' }, { id: 'v2' }], 'Sensitive (authZ-relevant) keys detected': ['isPremium'] } },
      { tabId: 2, logs: [], stats: { 'States saved': 2, 'HTTP events tracked (in scope)': 5, 'Max components seen in a snapshot': 70,
        'Vulnerability report': [{ id: 'v2' }], 'Sensitive (authZ-relevant) keys detected': ['isPremium', 'role'] } },
      { tabId: 3, logs: [], stats: { 'States saved': 0, 'Vulnerability report': 0, 'Sensitive (authZ-relevant) keys detected': 0 } },
    ] })!;
    assert.equal(e.tabs, 3);
    assert.equal(e.reactStatesSaved, 5);
    assert.equal(e.httpEventsTracked, 15);
    assert.equal(e.maxComponents, 70);
    assert.equal(e.vulnerabilities, 2);   // v2 reported by two tabs counts once
    assert.deepEqual(e.vulnerabilityIds, ['v1', 'v2']);
    assert.deepEqual(e.sensitiveKeyNames, ['isPremium', 'role']);
    assert.equal(e.sensitiveKeys, 2);
  });

  it('extensionStats accepts a single { logs, stats } object and returns null without data', () => {
    assert.equal(extensionStats({ data: { logs: [], stats: { 'Vulnerability report': [{ id: 'x' }] } } })?.vulnerabilities, 1);
    assert.equal(extensionStats({ data: null }), null);
    assert.equal(extensionStats({ data: [] }), null);
  });

  it('states and edges over all sites, extension metrics only over those with the extension', () => {
    const base = { folder: '', startedAt: '' };
    const ext = (vulnerabilities: number, reactStatesSaved: number) =>
      ({ ...extensionStats({ data: { stats: {} } })!, vulnerabilities, reactStatesSaved });
    const agg = aggregate([
      { ...base, site: 'a', states: 10, edges: 20, extension: ext(2, 6) },
      { ...base, site: 'b', states: 20, edges: 40, extension: ext(0, 2) },
      { ...base, site: 'c', states: 30, edges: 60, extension: null },   // still running
    ]);
    assert.equal(agg.averages.states, 20);
    assert.equal(agg.averages.vulnerabilities, 1);
    assert.equal(agg.averages.reactStatesSaved, 4);
    assert.equal(agg.totals.vulnerabilities, 2);
    assert.equal(agg.totals.edges, 120);
    assert.equal(agg.sitesWithExtension, 2);
    assert.equal(agg.sitesWithVulnerabilities, 1);
    const empty = aggregate([]);
    assert.equal(empty.averages.vulnerabilities, null);
    assert.equal(empty.totals.vulnerabilities, 0);
  });

  it('collect reads both running and completed folders', async () => {
    const dir = join(root, 'sites');
    const done = new FileOutput('done.test', dir, new Date('2026-10-30T10:00:00Z'));
    await done.saveState(record('s0'));
    await done.saveState(record('s1'));
    await done.saveJson('state-graph', { edges: [{}, {}, {}] });
    await done.saveJson('extension-end-__RAPIDOR__getData', [
      { tabId: 1, logs: [], stats: { 'Vulnerability report': [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }] } },
    ]);
    const running = new FileOutput('run.test', dir, new Date('2026-10-30T10:00:01Z'));
    await running.saveState(record('s0'));
    await mkdir(join(dir, 'altro'));   // unrelated folders are ignored
    await writeFile(join(dir, '_stats.json'), '{}');

    const agg = await collect(dir);
    assert.deepEqual(agg.perSite.map((s) => [s.site, s.states, s.edges, s.extension?.vulnerabilities ?? null]), [
      ['done.test', 2, 3, 4], ['run.test', 1, 0, null],
    ]);
    assert.equal(agg.averages.states, 1.5);
    assert.equal(agg.averages.edges, 1.5);
    assert.equal(agg.averages.vulnerabilities, 4);
  });
});
