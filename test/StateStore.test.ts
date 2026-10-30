import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Page } from 'playwright';
import { StateStore } from '../src/state/StateStore';
import type { UIState } from '../src/core/types';
import { MemoryOutput, descriptor } from './helpers/fakes';

const page = (screenshot = async () => Buffer.from('png')) => ({ screenshot } as unknown as Page);
const state = (id: string): UIState => ({
  id, url: 'https://app.test/', depth: 1, texts: ['Ciao'],
  clickables: [descriptor('a')],
  path: [{ type: 'click', target: descriptor('x') }],
});

describe('StateStore', () => {
  it('ricorda gli stati salvati e li conta', async () => {
    const store = new StateStore({ screenshots: false }, new MemoryOutput());
    assert.equal(store.has('S1'), false);
    await store.save(page(), state('S1'));
    assert.equal(store.has('S1'), true);
    assert.equal(store.count(), 1);
  });

  it('salva un record completo una sola volta per stato', async () => {
    const out = new MemoryOutput();
    const store = new StateStore({ screenshots: false }, out);
    await store.save(page(), state('S1'));
    await store.save(page(), state('S1'));
    assert.equal(out.states.length, 1);
    assert.deepEqual(out.states[0], {
      id: 'S1', url: 'https://app.test/', depth: 1, texts: ['Ciao'],
      clickables: [descriptor('a')],
      path: [{ type: 'click', targetId: 'x', text: 'x' }],
      screenshotKey: undefined,
    });
  });

  it('salva lo screenshot e ne registra la chiave', async () => {
    const out = new MemoryOutput();
    await new StateStore({ screenshots: true }, out).save(page(), state('S1'));
    assert.equal(out.states[0].screenshotKey, 'state-S1');
    assert.equal(out.files.get('state-S1')?.contentType, 'image/png');
  });

  it('se lo screenshot fallisce salva comunque lo stato, senza chiave', async () => {
    const out = new MemoryOutput();
    const failing = page(async () => { throw new Error('pagina chiusa'); });
    await new StateStore({ screenshots: true }, out).save(failing, state('S1'));
    assert.equal(out.states.length, 1);
    assert.equal(out.states[0].screenshotKey, undefined);
    assert.equal(out.files.size, 0);
  });

  it('tiene traccia delle coppie stato-elemento esplorate', () => {
    const store = new StateStore({ screenshots: false }, new MemoryOutput());
    assert.equal(store.isExplored('S1', 'a'), false);
    store.markExplored('S1', 'a');
    assert.equal(store.isExplored('S1', 'a'), true);
    assert.equal(store.isExplored('S2', 'a'), false);
    assert.equal(store.isExplored('S1', 'b'), false);
  });
});
