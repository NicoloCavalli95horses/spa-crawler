import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { PreindexedValueStore } from '../src/db/PreindexedValueStore';
import { ReactStateStore, type RapidorGraph } from '../src/db/ReactStateStore';

let root: string;
before(async () => { root = await mkdtemp(join(tmpdir(), 'crawler-test-')); });
after(async () => { await rm(root, { recursive: true, force: true }); });

function newStore(name: string, clearOnStart = false): PreindexedValueStore {
  return new PreindexedValueStore({ db: new Database(join(root, name)), clearOnStart });
}

const graph: RapidorGraph = {
  fingerprint: 'f',
  nodes: {
    'node-1': { id: 'node-1', componentId: 1, props: { id: 'free-id', title: 'ok' } },
    'node-2': { id: 'node-2', componentId: 1, props: { id: 'premium-id' } },
  },
};

describe('PreindexedValueStore', () => {
  it('reindex() populates rows findable by exact token value', () => {
    const store = newStore('a.db');
    store.reindex({ stateId: 1, graph });

    assert.deepEqual(store.findByValue('free-id'), [{ stateId: 1, nodeId: 'node-1', path: ['props', 'id'], depth: 2 }]);
    assert.deepEqual(store.findByValue('premium-id'), [{ stateId: 1, nodeId: 'node-2', path: ['props', 'id'], depth: 2 }]);
    assert.equal(store.findByValue('no-such-value').length, 0);
    assert.equal(store.count(), 3); // free-id, premium-id, 'ok' (title)
  });

  it('reindex() on the same stateId replaces its rows instead of accumulating', () => {
    const store = newStore('b.db');
    store.reindex({ stateId: 1, graph });
    store.reindex({ stateId: 1, graph: { fingerprint: 'g', nodes: { 'node-1': { id: 'node-1', props: { id: 'only-id' } } } } });

    assert.deepEqual(store.findByValue('free-id'), []);
    assert.deepEqual(store.findByValue('only-id'), [{ stateId: 1, nodeId: 'node-1', path: ['props', 'id'], depth: 2 }]);
  });

  it('rows from different states coexist', () => {
    const store = newStore('c.db');
    store.reindex({ stateId: 1, graph });
    store.reindex({ stateId: 2, graph: { fingerprint: 'g', nodes: { 'node-9': { id: 'node-9', props: { id: 'free-id' } } } } });

    const matches = store.findByValue('free-id');
    assert.deepEqual(matches.map((m) => m.stateId).sort(), [1, 2]);
  });

  it('clearOnStart wipes rows left by a previous run', () => {
    const path = join(root, 'd.db');
    const db = new Database(path);
    new PreindexedValueStore({ db, clearOnStart: false }).reindex({ stateId: 1, graph });
    assert.equal(new PreindexedValueStore({ db, clearOnStart: false }).count(), 3);

    assert.equal(new PreindexedValueStore({ db, clearOnStart: true }).count(), 0);
  });

  it('clearSite removes only the rows whose state belongs to that domain', () => {
    const db = new Database(join(root, 'e.db'));
    const states = new ReactStateStore({ db, clearOnStart: false });
    const preindex = new PreindexedValueStore({ db, clearOnStart: false });

    const stateA = states.record({ site: 'a.test', url: 'https://a.test/x', graph })!;
    const stateB = states.record({ site: 'b.test', url: 'https://b.test/x', graph })!;
    preindex.reindex({ stateId: stateA, graph });
    preindex.reindex({ stateId: stateB, graph });

    preindex.clearSite({ site: 'a.test' });

    assert.deepEqual(preindex.findByValue('free-id').map((m) => m.stateId), [stateB]);
  });
});
