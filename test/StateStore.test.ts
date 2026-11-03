import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import type { Page } from 'playwright';
import { StateStore } from '../src/state/StateStore';
import { CrawlStateStore } from '../src/db/CrawlStateStore';
import type { UIState } from '../src/core/types';
import { descriptor } from './helpers/fakes';

let root: string;
before(async () => { root = await mkdtemp(join(tmpdir(), 'crawler-test-')); });
after(async () => { await rm(root, { recursive: true, force: true }); });

let n = 0;
function newStore(screenshots = false): { store: StateStore; persistent: CrawlStateStore } {
  const persistent = new CrawlStateStore({ db: new Database(join(root, `${n++}.db`)), clearOnStart: false });
  return { store: new StateStore({ screenshots }, 'a.test', persistent), persistent };
}

const page = (screenshot = async () => Buffer.from('png')) => ({ screenshot } as unknown as Page);
const state = (id: string): UIState => ({
  id, url: 'https://app.test/', depth: 1, texts: ['Ciao'],
  clickables: [descriptor('a')],
  path: [{ type: 'click', target: descriptor('x') }],
});

describe('StateStore', () => {
  it('remembers saved states and counts them', async () => {
    const { store } = newStore();
    assert.equal(store.has('S1'), false);
    await store.save(page(), state('S1'));
    assert.equal(store.has('S1'), true);
    assert.equal(store.count(), 1);
  });

  it('saves a full record only once per state', async () => {
    const { store, persistent } = newStore();
    await store.save(page(), state('S1'));
    await store.save(page(), state('S1'));
    const rows = persistent.listBySite('a.test');
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0], {
      id: 'S1', url: 'https://app.test/', depth: 1, texts: ['Ciao'],
      clickables: [descriptor('a')],
      path: [{ type: 'click', targetId: 'x', text: 'x' }],
      hasScreenshot: false,
    });
  });

  it('saves the screenshot alongside the state', async () => {
    const { store, persistent } = newStore(true);
    await store.save(page(), state('S1'));
    assert.equal(persistent.listBySite('a.test')[0].hasScreenshot, true);
  });

  it('if the screenshot fails, still saves the state without one', async () => {
    const { store, persistent } = newStore(true);
    const failing = page(async () => { throw new Error('pagina chiusa'); });
    await store.save(failing, state('S1'));
    const rows = persistent.listBySite('a.test');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].hasScreenshot, false);
  });

  it('tracks the explored state-element pairs', () => {
    const { store } = newStore();
    assert.equal(store.isExplored('S1', 'a'), false);
    store.markExplored('S1', 'a');
    assert.equal(store.isExplored('S1', 'a'), true);
    assert.equal(store.isExplored('S2', 'a'), false);
    assert.equal(store.isExplored('S1', 'b'), false);
  });
});
