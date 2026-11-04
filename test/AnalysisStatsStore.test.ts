import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { AnalysisStatsStore, type AnalysisStatsRow } from '../src/db/AnalysisStatsStore';

let root: string;
before(async () => { root = await mkdtemp(join(tmpdir(), 'crawler-test-')); });
after(async () => { await rm(root, { recursive: true, force: true }); });

function newStore(name: string, clearOnStart = false): AnalysisStatsStore {
  return new AnalysisStatsStore({ db: new Database(join(root, name)), clearOnStart });
}

const row = (extra: Partial<AnalysisStatsRow> = {}): AnalysisStatsRow => ({
  site: 'a.test', httpEvents: 10, segmentsExtracted: 5, reactStates: 3,
  matchesFound: 2, candidatesFound: 4, requestsGenerated: 4, vulnerabilitiesFlagged: 1,
  explorationMs: 12_345, analysisMs: 678,
  ...extra,
});

describe('AnalysisStatsStore', () => {
  it('records one row per site and reads it back', () => {
    const store = newStore('a.db');
    store.record(row());
    assert.deepEqual(store.all(), [row()]);
  });

  it('a second record() for the same site replaces the row instead of adding one', () => {
    const store = newStore('b.db');
    store.record(row());
    store.record(row({ httpEvents: 20, vulnerabilitiesFlagged: 2 }));
    assert.deepEqual(store.all(), [row({ httpEvents: 20, vulnerabilitiesFlagged: 2 })]);
  });

  it('keeps rows for different sites separate, ordered by site', () => {
    const store = newStore('c.db');
    store.record(row({ site: 'b.test' }));
    store.record(row({ site: 'a.test' }));
    assert.deepEqual(store.all().map((r) => r.site), ['a.test', 'b.test']);
  });

  it('clearOnStart wipes rows left by a previous run', () => {
    const path = join(root, 'd.db');
    const db = new Database(path);
    new AnalysisStatsStore({ db, clearOnStart: false }).record(row());
    assert.equal(new AnalysisStatsStore({ db, clearOnStart: false }).all().length, 1);

    assert.equal(new AnalysisStatsStore({ db, clearOnStart: true }).all().length, 0);
  });
});
