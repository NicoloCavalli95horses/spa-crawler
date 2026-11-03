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
  pageUrl: 'https://a.test/',
  requestHeaders: {},
  timestamp: '2026-11-03T00:00:00.000Z',
  ...extra,
});

function newDb(name: string): Database.Database {
  return new Database(join(root, name));
}

function rowsOf(db: Database.Database): unknown[] {
  return db.prepare('SELECT * FROM http_events').all();
}

describe('HttpEventStore', () => {
  it('records a request once and dedupes an identical repeat into seen_count', () => {
    const db = newDb('a.db');
    const store = new HttpEventStore({ db, clearOnStart: false });
    store.record({ site: 'a.test', request: request() });
    store.record({ site: 'a.test', request: request() });

    const rows = rowsOf(db) as { seen_count: number }[];
    assert.equal(rows.length, 1);
    assert.equal(rows[0].seen_count, 2);
    assert.equal(store.count('a.test'), 1);
  });

  it('keeps the same fingerprint separate across different sites', () => {
    const db = newDb('b.db');
    const store = new HttpEventStore({ db, clearOnStart: false });
    store.record({ site: 'a.test', request: request() });
    store.record({ site: 'b.test', request: request() });

    assert.equal(rowsOf(db).length, 2);
    assert.equal(store.count(), 2);
  });

  it('a different postData on the same method+url is a distinct event', () => {
    const db = newDb('c.db');
    const store = new HttpEventStore({ db, clearOnStart: false });
    store.record({ site: 'a.test', request: request({ method: 'POST', postData: '{"id":1}' }) });
    store.record({ site: 'a.test', request: request({ method: 'POST', postData: '{"id":2}' }) });

    assert.equal(rowsOf(db).length, 2);
  });

  it('clearOnStart wipes rows left by a previous run', () => {
    const db = newDb('d.db');
    new HttpEventStore({ db, clearOnStart: false }).record({ site: 'a.test', request: request() });
    assert.equal(rowsOf(db).length, 1);

    new HttpEventStore({ db, clearOnStart: true });
    assert.equal(rowsOf(db).length, 0);
  });
});
