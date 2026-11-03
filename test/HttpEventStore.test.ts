import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { HttpEventStore } from '../src/db/HttpEventStore';
import type { CapturedRequest } from '../src/browser/NetworkObserver';

let root: string;
before(async () => { root = await mkdtemp(join(tmpdir(), 'crawler-test-')); });
after(async () => { await rm(root, { recursive: true, force: true }); });

const request = (extra: Partial<CapturedRequest> = {}): CapturedRequest => ({
  url: 'https://a.test/api/items',
  method: 'GET',
  requestHeaders: {},
  timestamp: '2026-11-03T00:00:00.000Z',
  ...extra,
});

function rowsOf(dbPath: string): unknown[] {
  const db = new Database(dbPath, { readonly: true });
  try {
    return db.prepare('SELECT * FROM http_events').all();
  } finally {
    db.close();
  }
}

describe('HttpEventStore', () => {
  it('records a request once and dedupes an identical repeat into seen_count', () => {
    const path = join(root, 'a.db');
    const store = new HttpEventStore({ path, clearOnStart: false });
    store.record({ site: 'a.test', request: request() });
    store.record({ site: 'a.test', request: request() });

    const rows = rowsOf(path) as { seen_count: number }[];
    assert.equal(rows.length, 1);
    assert.equal(rows[0].seen_count, 2);
    assert.equal(store.count('a.test'), 1);
  });

  it('keeps the same fingerprint separate across different sites', () => {
    const path = join(root, 'b.db');
    const store = new HttpEventStore({ path, clearOnStart: false });
    store.record({ site: 'a.test', request: request() });
    store.record({ site: 'b.test', request: request() });

    assert.equal(rowsOf(path).length, 2);
    assert.equal(store.count(), 2);
  });

  it('a different postData on the same method+url is a distinct event', () => {
    const path = join(root, 'c.db');
    const store = new HttpEventStore({ path, clearOnStart: false });
    store.record({ site: 'a.test', request: request({ method: 'POST', postData: '{"id":1}' }) });
    store.record({ site: 'a.test', request: request({ method: 'POST', postData: '{"id":2}' }) });

    assert.equal(rowsOf(path).length, 2);
  });

  it('clearOnStart wipes rows left by a previous run', () => {
    const path = join(root, 'd.db');
    new HttpEventStore({ path, clearOnStart: false }).record({ site: 'a.test', request: request() });
    assert.equal(rowsOf(path).length, 1);

    new HttpEventStore({ path, clearOnStart: true });
    assert.equal(rowsOf(path).length, 0);
  });
});
