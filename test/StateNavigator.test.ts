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
  it('non ricarica se si trova già nello stato richiesto', async () => {
    const app = new FakeApp(APP);
    app.current = 'S2';
    assert.equal(await setup(app).restore(app.page(), target('S2', ['a', 'b'])), true);
    assert.equal(app.gotoCount, 0);
  });

  it('altrimenti ricarica e ripete il percorso in ordine', async () => {
    const app = new FakeApp(APP);
    app.current = 'S3';
    assert.equal(await setup(app).restore(app.page(), target('S2', ['a', 'b'])), true);
    assert.equal(app.gotoCount, 1);
    assert.deepEqual(app.clicks, ['S0.a', 'S1.b']);
    assert.equal(app.current, 'S2');
  });

  it('per la radice basta il ricaricamento', async () => {
    const app = new FakeApp(APP);
    app.current = 'S1';
    assert.equal(await setup(app).restore(app.page(), target('S0', [])), true);
    assert.deepEqual(app.clicks, []);
  });

  it("restituisce false se un'azione del percorso fallisce", async () => {
    const app = new FakeApp(APP);
    app.current = 'S3';
    assert.equal(await setup(app).restore(app.page(), target('S2', ['a', 'manca'])), false);
  });

  it('restituisce false se dopo il replay lo stato è diverso (UI non deterministica)', async () => {
    const app = new FakeApp(APP);
    app.current = 'S3';
    assert.equal(await setup(app).restore(app.page(), target('S9', ['a', 'b'])), false);
  });
});
