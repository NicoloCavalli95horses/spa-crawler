import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StateNavigator } from '../src/browser/StateNavigator';
import type { UIState } from '../src/core/types';
import { FakeApp, descriptor, noWait } from './helpers/fakes';

const target = (id: string, path: string[]): UIState => ({
  id, url: '', depth: path.length, clickables: [], texts: [],
  path: path.map((p) => ({ type: 'click', target: descriptor(p) })),
});

function setup(app: FakeApp) {
  return new StateNavigator('https://app.test/', app.executor(), noWait, app.capturer());
}

const APP = { S0: { a: 'S1' }, S1: { b: 'S2', c: 'S3' }, S2: {}, S3: {} };

describe('StateNavigator', () => {
  it('does not reload when already in the requested state', async () => {
    const app = new FakeApp(APP);
    app.current = 'S2';
    assert.equal(await setup(app).restore(app.page(), target('S2', ['a', 'b'])), true);
    assert.equal(app.gotoCount, 0);
  });

  it('otherwise reloads and replays the path in order', async () => {
    const app = new FakeApp(APP);
    app.current = 'S3';
    assert.equal(await setup(app).restore(app.page(), target('S2', ['a', 'b'])), true);
    assert.equal(app.gotoCount, 1);
    assert.deepEqual(app.clicks, ['S0.a', 'S1.b']);
    assert.equal(app.current, 'S2');
  });

  it('for the root a reload is enough', async () => {
    const app = new FakeApp(APP);
    app.current = 'S1';
    assert.equal(await setup(app).restore(app.page(), target('S0', [])), true);
    assert.deepEqual(app.clicks, []);
  });

  it('returns false when an action on the path fails', async () => {
    const app = new FakeApp(APP);
    app.current = 'S3';
    assert.equal(await setup(app).restore(app.page(), target('S2', ['a', 'manca'])), false);
  });

  it('returns false when the state differs after the replay (non-deterministic UI)', async () => {
    const app = new FakeApp(APP);
    app.current = 'S3';
    assert.equal(await setup(app).restore(app.page(), target('S9', ['a', 'b'])), false);
  });
});
