import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { ReactStateStore } from '../src/db/ReactStateStore';
import { HttpEventStore } from '../src/db/HttpEventStore';

let root: string;
before(async () => { root = await mkdtemp(join(tmpdir(), 'crawler-test-')); });
after(async () => { await rm(root, { recursive: true, force: true }); });

function newDb(name: string): Database.Database {
  return new Database(join(root, name));
}

function rowsOf(db: Database.Database): unknown[] {
  return db.prepare('SELECT * FROM react_states').all();
}

describe('ReactStateStore', () => {
  it('records a graph once and dedupes an identical repeat into seen_count', () => {
    const db = newDb('a.db');
    const store = new ReactStateStore({ db, clearOnStart: false });
    store.record({ site: 'a.test', url: 'https://a.test/', graph: { fingerprint: 'f1' } });
    store.record({ site: 'a.test', url: 'https://a.test/', graph: { fingerprint: 'f1' } });

    const rows = rowsOf(db) as { seen_count: number }[];
    assert.equal(rows.length, 1);
    assert.equal(rows[0].seen_count, 2);
    assert.equal(store.count('https://a.test/'), 1);
  });

  it('keeps the same fingerprint separate across different URLs', () => {
    const db = newDb('b.db');
    const store = new ReactStateStore({ db, clearOnStart: false });
    store.record({ site: 'a.test', url: 'https://a.test/x', graph: { fingerprint: 'f1' } });
    store.record({ site: 'a.test', url: 'https://a.test/y', graph: { fingerprint: 'f1' } });

    assert.equal(rowsOf(db).length, 2);
    assert.equal(store.count(), 2);
  });

  it('keeps two different fingerprints at the same URL separate (e.g. a modal toggled open)', () => {
    const db = newDb('c.db');
    const store = new ReactStateStore({ db, clearOnStart: false });
    store.record({ site: 'a.test', url: 'https://a.test/', graph: { fingerprint: 'closed' } });
    store.record({ site: 'a.test', url: 'https://a.test/', graph: { fingerprint: 'open' } });

    assert.equal(rowsOf(db).length, 2);
  });

  it('skips a graph without a fingerprint', () => {
    const db = newDb('d.db');
    const store = new ReactStateStore({ db, clearOnStart: false });
    store.record({ site: 'a.test', url: 'https://a.test/', graph: undefined });
    store.record({ site: 'a.test', url: 'https://a.test/', graph: null });

    assert.equal(rowsOf(db).length, 0);
  });

  it('clearOnStart wipes only react_states, not a sibling http_events table', () => {
    const db = newDb('e.db');
    new HttpEventStore({ db, clearOnStart: false }).record({
      site: 'a.test',
      request: { url: 'https://a.test/api', method: 'GET', requestHeaders: {}, timestamp: '2026-11-03T00:00:00.000Z' },
    });
    new ReactStateStore({ db, clearOnStart: false }).record({ site: 'a.test', url: 'https://a.test/', graph: { fingerprint: 'f1' } });
    assert.equal(rowsOf(db).length, 1);

    new ReactStateStore({ db, clearOnStart: true });
    assert.equal(rowsOf(db).length, 0);
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM http_events').get() as { n: number }).n, 1);
  });
});
