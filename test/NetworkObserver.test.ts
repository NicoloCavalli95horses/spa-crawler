import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { NetworkObserver } from '../src/browser/NetworkObserver';
import { HttpEventStore } from '../src/db/HttpEventStore';
import { APP_ORIGIN, useBrowser } from './helpers/browser';

const browser = useBrowser();

let root: string;
before(async () => { root = await mkdtemp(join(tmpdir(), 'crawler-test-')); });
after(async () => { await rm(root, { recursive: true, force: true }); });

/** Captures resolve asynchronously (headers/body are read after 'requestfinished' fires): poll instead of a fixed sleep. */
async function waitUntil(fn: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!fn()) {
    if (Date.now() > deadline) throw new Error('waitUntil: timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('NetworkObserver', () => {
  it('captures a same-site fetch (method, status, headers, body)', async () => {
    const page = await browser.open({ '/': '<p>app</p>' });
    await page.route(`${APP_ORIGIN}/api/items`, (route) => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }),
    }));
    const observer = new NetworkObserver({ origin: APP_ORIGIN });
    observer.attach(page);

    await page.evaluate(() => fetch('/api/items', { method: 'POST', body: '{}' }));
    await waitUntil(() => observer.snapshot().requests.length === 1);

    const { requests, stats } = observer.snapshot();
    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, 'POST');
    assert.equal(requests[0].url, `${APP_ORIGIN}/api/items`);
    assert.equal(requests[0].status, 200);
    assert.equal(requests[0].contentType, 'application/json');
    assert.equal(requests[0].responseBody, '{"ok":true}');
    assert.deepEqual(stats, { total: 1, byMethod: { POST: 1 }, byStatus: { '200': 1 }, failed: 0, skippedOffDomain: 0 });
  });

  it('excludes cross-site requests but counts them as skipped', async () => {
    const page = await browser.open({ '/': '<p>app</p>' });
    await page.route('https://other.test/data', (route) => route.fulfill({
      status: 200, contentType: 'application/json', body: '{}',
    }));
    const observer = new NetworkObserver({ origin: APP_ORIGIN });
    observer.attach(page);

    await page.evaluate(() => fetch('https://other.test/data'));
    await waitUntil(() => observer.snapshot().stats.skippedOffDomain === 1);

    const { requests, stats } = observer.snapshot();
    assert.equal(requests.length, 0);
    assert.equal(stats.skippedOffDomain, 1);
    assert.equal(stats.total, 0);
  });

  it('shares captures across several attached pages', async () => {
    const pageA = await browser.open({ '/': '<p>a</p>' });
    const pageB = await browser.open({ '/': '<p>b</p>' });
    for (const p of [pageA, pageB]) {
      await p.route(`${APP_ORIGIN}/ping`, (route) => route.fulfill({ status: 204, body: '' }));
    }
    const observer = new NetworkObserver({ origin: APP_ORIGIN });
    observer.attach(pageA);
    observer.attach(pageB);

    await pageA.evaluate(() => fetch('/ping'));
    await pageB.evaluate(() => fetch('/ping'));
    await waitUntil(() => observer.snapshot().stats.total === 2);

    assert.equal(observer.snapshot().stats.total, 2);
  });

  it('forwards every captured request to its HttpEventStore', async () => {
    const page = await browser.open({ '/': '<p>app</p>' });
    await page.route(`${APP_ORIGIN}/api/items`, (route) => route.fulfill({
      status: 200, contentType: 'application/json', body: '{}',
    }));
    const db = new Database(join(root, 'store.db'));
    const store = new HttpEventStore({ db, clearOnStart: false });
    const observer = new NetworkObserver({ origin: APP_ORIGIN, store });
    observer.attach(page);

    await page.evaluate(() => fetch('/api/items'));
    await waitUntil(() => store.count() === 1);

    assert.equal(store.count(new URL(APP_ORIGIN).hostname), 1);
  });
});
