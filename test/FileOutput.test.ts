import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileOutput, folderTimestamp } from '../src/state/output/FileOutput';
import { aggregate, collect, parseFolder } from '../src/stats/aggregate';
import type { StateRecord } from '../src/core/types';

const record = (id: string): StateRecord => ({ id, url: `https://a.test/${id}`, depth: 0, path: [], clickables: [], texts: ['è'] });

let root: string;
before(async () => { root = await mkdtemp(join(tmpdir(), 'crawler-test-')); });
after(async () => { await rm(root, { recursive: true, force: true }); });

describe('FileOutput', () => {
  it('crea la cartella <sito>_<timestamp>', () => {
    const out = new FileOutput('a.test', root, new Date('2026-10-30T12:16:20.701Z'));
    assert.equal(out.dir, join(root, 'a.test_2026-10-30T12-16-20'));
    assert.equal(folderTimestamp(new Date('2026-01-02T03:04:05Z')), '2026-01-02T03-04-05');
  });

  it('states.json resta un array JSON valido dopo ogni stato', async () => {
    const out = new FileOutput('a.test', root, new Date('2026-10-30T10:00:00Z'));
    for (const id of ['s0', 's1', 's2']) {
      await out.saveState(record(id));
      const parsed = JSON.parse(await readFile(join(out.dir, 'states.json'), 'utf8'));
      assert.equal(parsed.at(-1).id, id);
    }
    assert.deepEqual(JSON.parse(await readFile(join(out.dir, 'states.json'), 'utf8')).map((s: StateRecord) => s.id), ['s0', 's1', 's2']);
  });

  it('scritture concorrenti non si mescolano', async () => {
    const out = new FileOutput('b.test', root, new Date('2026-10-30T10:00:00Z'));
    await Promise.all(['x', 'y', 'z', 'w'].map((id) => out.saveState(record(id))));
    assert.equal(JSON.parse(await readFile(join(out.dir, 'states.json'), 'utf8')).length, 4);
  });

  it('saveJson riscrive il file e non lascia temporanei', async () => {
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

  it('medie: stati e archi su tutti i siti, IDOR solo su quelli con estensione', () => {
    const base = { folder: '', startedAt: '' };
    const agg = aggregate([
      { ...base, site: 'a', states: 10, edges: 20, potentialIdor: 2 },
      { ...base, site: 'b', states: 20, edges: 40, potentialIdor: null },   // ancora in corso
    ]);
    assert.deepEqual(agg.averages, { states: 15, edges: 30, potentialIdor: 2 });
    assert.equal(agg.sitesWithExtension, 1);
    assert.deepEqual(aggregate([]).averages, { states: null, edges: null, potentialIdor: null });
  });

  it('collect legge cartelle in corso e complete', async () => {
    const dir = join(root, 'sites');
    const done = new FileOutput('done.test', dir, new Date('2026-10-30T10:00:00Z'));
    await done.saveState(record('s0'));
    await done.saveState(record('s1'));
    await done.saveJson('state-graph', { edges: [{}, {}, {}] });
    await done.saveJson('extension-end-__RAPIDOR__getData', { logs: [], stats: { 'Potential IDOR reported': 4 } });
    const running = new FileOutput('run.test', dir, new Date('2026-10-30T10:00:01Z'));
    await running.saveState(record('s0'));
    await mkdir(join(dir, 'altro'));   // cartelle estranee ignorate
    await writeFile(join(dir, '_stats.json'), '{}');

    const agg = await collect(dir);
    assert.deepEqual(agg.perSite.map((s) => [s.site, s.states, s.edges, s.potentialIdor]), [
      ['done.test', 2, 3, 4], ['run.test', 1, 0, null],
    ]);
    assert.deepEqual(agg.averages, { states: 1.5, edges: 1.5, potentialIdor: 4 });
  });
});
