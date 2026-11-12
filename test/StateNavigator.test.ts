import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Page } from 'playwright';
import { StateNavigator } from '../src/browser/StateNavigator';
import type { IActionExecutor } from '../src/core/interfaces';
import type { UIState } from '../src/core/types';
import { FakeApp, descriptor, noWait } from './helpers/fakes';

// A state the fake app can be restored to: its url mirrors FakeApp.page() (`#<id>`), its path is the
// sequence of clicks from the root, and `el` is the element restore must find present once there.
const target = (id: string, path: string[]): UIState => ({
  id, url: `https://app.test/#${id}`, depth: path.length, clickables: [], texts: [],
  path: path.map((p) => ({ type: 'click', target: descriptor(p) })),
});

function setup(app: FakeApp) {
  // timeoutMs: 0 — no presence retry in unit tests, so a legitimately-absent element fails at once
  return new StateNavigator('https://app.test/', app.executor(), noWait, undefined, { timeoutMs: 0 });
}

// S2 and S4 carry a clickable so a restore of them has an element to locate.
const APP = { S0: { a: 'S1' }, S1: { b: 'S2', c: 'S3' }, S2: { x: 'S4' }, S3: {}, S4: {} };

describe('StateNavigator', () => {
  it('does not reload when already on the route with the element present', async () => {
    const app = new FakeApp(APP);
    app.current = 'S2';
    assert.equal(await setup(app).restore(app.page(), target('S2', ['a', 'b']), descriptor('x')), true);
    assert.equal(app.gotoCount, 0);
  });

  it('otherwise reloads and replays the path in order', async () => {
    const app = new FakeApp(APP);
    app.current = 'S3';
    assert.equal(await setup(app).restore(app.page(), target('S2', ['a', 'b']), descriptor('x')), true);
    assert.equal(app.gotoCount, 1);
    assert.deepEqual(app.clicks, ['S0.a', 'S1.b']);
    assert.equal(app.current, 'S2');
  });

  it('for the root a reload is enough', async () => {
    const app = new FakeApp(APP);
    app.current = 'S1';
    assert.equal(await setup(app).restore(app.page(), target('S0', []), descriptor('a')), true);
    assert.deepEqual(app.clicks, []);
  });

  it('returns false when an action on the path fails', async () => {
    const app = new FakeApp(APP);
    app.current = 'S3';
    assert.equal(await setup(app).restore(app.page(), target('S2', ['a', 'manca']), descriptor('x')), false);
  });

  it('returns false when the route differs after the replay (non-deterministic UI)', async () => {
    const app = new FakeApp(APP);
    app.current = 'S3';
    assert.equal(await setup(app).restore(app.page(), target('S9', ['a', 'b']), descriptor('x')), false);
  });

  it('returns false when the route matches but the element is no longer there', async () => {
    const app = new FakeApp(APP);
    app.current = 'S2';
    // on the right route (S2) but the element to click (zzz) is not one of S2's clickables
    assert.equal(await setup(app).restore(app.page(), target('S2', ['a', 'b']), descriptor('zzz')), false);
  });
});

// Route comparison includes the query string: restore must land on the exact same URL, not just the
// same path. These use hand-rolled stubs so the page URL can carry a query the FakeApp hash cannot.
describe('StateNavigator route matching', () => {
  const stub = (url: string): { page: Page; executor: IActionExecutor } => ({
    page: { url: () => url, goto: async () => null } as unknown as Page,
    executor: { execute: async () => true, locate: async () => true } as IActionExecutor,
  });
  const state = (url: string): UIState => ({ id: 'x', url, depth: 0, clickables: [], texts: [], path: [] });

  it('rejects a page that differs only by query parameter value', async () => {
    const { page, executor } = stub('https://app.test/p?id=297');
    const nav = new StateNavigator('https://app.test/p?id=297', executor, noWait, undefined, { timeoutMs: 0 });
    assert.equal(await nav.restore(page, state('https://app.test/p?id=296'), descriptor('x')), false);
  });

  it('accepts the same query parameters regardless of order', async () => {
    const { page, executor } = stub('https://app.test/p?a=1&b=2');
    const nav = new StateNavigator('https://app.test/p?a=1&b=2', executor, noWait, undefined, { timeoutMs: 0 });
    assert.equal(await nav.restore(page, state('https://app.test/p?b=2&a=1'), descriptor('x')), true);
  });

  it('retries the presence check while an async element is still rendering', async () => {
    // locate only becomes true on the 3rd call: the element renders after the reload settled,
    // just as the MiniLearn lesson cards do after their data fetch.
    let calls = 0;
    const page = {
      url: () => 'https://app.test/', goto: async () => null, waitForTimeout: async () => {},
    } as unknown as Page;
    const executor = { execute: async () => true, locate: async () => ++calls >= 3 } as IActionExecutor;
    const nav = new StateNavigator('https://app.test/', executor, noWait, undefined, { timeoutMs: 1000, pollMs: 1 });
    assert.equal(await nav.restore(page, state('https://app.test/'), descriptor('x')), true);
    assert.ok(calls >= 3, `expected at least 3 locate attempts, got ${calls}`);
  });
});
