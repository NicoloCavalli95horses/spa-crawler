import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { ReactStateHooks } from '../src/browser/ReactStateHooks';
import { ReactStateStore } from '../src/db/ReactStateStore';
import { useBrowser } from './helpers/browser';

const { withHtml } = useBrowser();

let root: string;
before(async () => { root = await mkdtemp(join(tmpdir(), 'crawler-test-')); });
after(async () => { await rm(root, { recursive: true, force: true }); });

function newStore(name: string): ReactStateStore {
  return new ReactStateStore({ db: new Database(join(root, name)), clearOnStart: false });
}

function rowsOf(store: ReactStateStore): number {
  return store.count();
}

const withState = (fingerprint: string) =>
  `<script>window.__RAPIDOR__getLatestState = () => ({ fingerprint: '${fingerprint}' })</script>`;

describe('ReactStateHooks', () => {
  it('beforeAction records the current page state under its URL', async () => {
    const store = newStore('a.db');
    const hooks = new ReactStateHooks(store);
    const page = await withHtml(withState('f1'));

    await hooks.beforeAction(page);

    assert.equal(rowsOf(store), 1);
  });

  it('afterAction records too, and a repeat on the same page just bumps seen_count', async () => {
    const store = newStore('b.db');
    const hooks = new ReactStateHooks(store);
    const page = await withHtml(withState('f1'));

    await hooks.beforeAction(page);
    await hooks.afterAction(page);

    assert.equal(rowsOf(store), 1);   // same URL, same fingerprint: one row, seen_count bumped
  });

  it('does not throw and records nothing when the extension is absent', async () => {
    const store = newStore('c.db');
    const hooks = new ReactStateHooks(store);
    const page = await withHtml('<p>no extension here</p>');

    await assert.doesNotReject(() => hooks.beforeAction(page));
    assert.equal(rowsOf(store), 0);
  });
});
