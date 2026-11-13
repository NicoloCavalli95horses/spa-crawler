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

  it('claims a pair exclusively and closes it on a successful attempt', () => {
    const { store } = newStore();
    assert.equal(store.isClaimable('S1', 'a'), true);
    assert.equal(store.claim('S1', 'a'), true);
    assert.equal(store.claim('S1', 'a'), false, 'a claimed pair cannot be claimed again while in progress');
    assert.equal(store.isClaimable('S1', 'a'), false, 'in-progress pair is not claimable');
    store.release('S1', 'a', 'done');
    assert.equal(store.isDone('S1', 'a'), true);
    assert.equal(store.claim('S1', 'a'), false, 'a done pair is never claimable again');
    // other pairs are independent
    assert.equal(store.isClaimable('S2', 'a'), true);
    assert.equal(store.isClaimable('S1', 'b'), true);
  });

  it('retries a missed pair until the attempt budget runs out, then gives up', () => {
    const s = new StateStore({ screenshots: false, restoreAttempts: 3 }, 'a.test', newStore().persistent);
    // miss 1
    assert.equal(s.claim('S1', 'a'), true);
    s.release('S1', 'a', 'miss');
    assert.equal(s.isDone('S1', 'a'), false, 'still has budget after one miss');
    assert.equal(s.isClaimable('S1', 'a'), true, 'released for another attempt');
    // miss 2
    assert.equal(s.claim('S1', 'a'), true);
    s.release('S1', 'a', 'miss');
    assert.equal(s.isDone('S1', 'a'), false);
    // miss 3 reaches the budget (3) -> given up
    assert.equal(s.claim('S1', 'a'), true);
    s.release('S1', 'a', 'miss');
    assert.equal(s.isDone('S1', 'a'), true, 'out of budget: given up as unreachable');
    assert.equal(s.isClaimable('S1', 'a'), false);
  });

  it('a success after a miss still closes the pair', () => {
    const s = new StateStore({ screenshots: false, restoreAttempts: 4 }, 'a.test', newStore().persistent);
    s.claim('S1', 'a');
    s.release('S1', 'a', 'miss');
    s.claim('S1', 'a');
    s.release('S1', 'a', 'done');
    assert.equal(s.isDone('S1', 'a'), true);
  });
});
