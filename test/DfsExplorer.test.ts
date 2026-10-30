import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DfsExplorer, type ExplorationLimits } from '../src/core/DfsExplorer';
import { StateNavigator } from '../src/browser/StateNavigator';
import { StateStore } from '../src/state/StateStore';
import { StateGraph } from '../src/state/StateGraph';
import type { IStateCapturer } from '../src/core/interfaces';
import { FakeApp, MemoryOutput, noWait } from './helpers/fakes';

/** Motore reale (navigatore, store, grafo) su un'app simulata. */
function run(app: FakeApp, limits: Partial<ExplorationLimits> = {}, capturer?: IStateCapturer) {
  const out = new MemoryOutput();
  const cap = capturer ?? app.capturer();
  const executor = app.executor();
  const navigator = new StateNavigator('https://app.test/', executor, noWait, cap);
  const store = new StateStore({ screenshots: false }, out);
  const graph = new StateGraph(out);
  const explorer = new DfsExplorer(noWait, executor, cap, navigator, store, graph,
    { maxDepth: 10, maxStates: 1000, ...limits });
  const saved = () => out.states.map((s) => s.id).sort();
  return { explorer, out, graph, saved, explore: () => explorer.explore(app.page()) };
}

describe('DfsExplorer', () => {
  it('visita tutti gli stati raggiungibili, anche con cicli', async () => {
    const app = new FakeApp({
      S0: { a: 'S1', b: 'S2' },
      S1: { back: 'S0', c: 'S3' },
      S2: { d: 'S3' },
      S3: { home: 'S0' },
    });
    const r = run(app);
    await r.explore();
    assert.deepEqual(r.saved(), ['S0', 'S1', 'S2', 'S3']);
    assert.equal(r.graph.edgeCount(), 6);
  });

  it('salva gli stati alla profondità massima ma non li espande', async () => {
    const app = new FakeApp({ S0: { a: 'S1' }, S1: { b: 'S2' }, S2: { c: 'S3' }, S3: {} });
    const r = run(app, { maxDepth: 2 });
    await r.explore();
    assert.deepEqual(r.saved(), ['S0', 'S1', 'S2']);
  });

  it('registra profondità e percorso di ogni stato', async () => {
    const app = new FakeApp({ S0: { a: 'S1' }, S1: { b: 'S2' }, S2: {} });
    const r = run(app);
    await r.explore();
    const s2 = r.out.states.find((s) => s.id === 'S2')!;
    assert.equal(s2.depth, 2);
    assert.deepEqual(s2.path.map((p) => p.targetId), ['a', 'b']);
  });

  it('dopo la profondità massima torna allo stato di partenza e prova il cliccabile successivo', async () => {
    const app = new FakeApp({ S0: { a: 'S1', b: 'S2' }, S1: { c: 'S3' }, S2: {}, S3: {} });
    const r = run(app, { maxDepth: 1 });
    await r.explore();
    assert.deepEqual(app.clicks, ['S0.a', 'S0.b']);
    assert.deepEqual(r.saved(), ['S0', 'S1', 'S2']);
  });

  it('non riespande uno stato già visto', async () => {
    const app = new FakeApp({ S0: { a: 'S1', b: 'S1' }, S1: { c: 'S2' }, S2: {} });
    const r = run(app);
    await r.explore();
    assert.equal(app.clicks.filter((c) => c === 'S1.c').length, 1);
    assert.equal(r.graph.edgeCount(), 3);   // S0-a->S1, S0-b->S1, S1-c->S2
  });

  it('si ferma al numero massimo di stati', async () => {
    const app = new FakeApp({ S0: { a: 'S1', b: 'S2', c: 'S3' }, S1: {}, S2: {}, S3: {} });
    const r = run(app, { maxStates: 2 });
    await r.explore();
    assert.equal(r.out.states.length, 2);
  });

  it('un errore su un elemento non interrompe gli altri', async () => {
    const app = new FakeApp({ S0: { a: 'THROW', b: 'S1' }, S1: {} });
    const r = run(app);
    await r.explore();
    assert.deepEqual(r.saved(), ['S0', 'S1']);
  });

  it('salva il grafo anche se l\'esplorazione fallisce', async () => {
    const app = new FakeApp({ S0: {} });
    const broken: IStateCapturer = { capture: async () => { throw new Error('pagina rotta'); } };
    const r = run(app, {}, broken);
    await assert.rejects(r.explore(), /pagina rotta/);
    assert.ok(r.out.json.has('state-graph'));
  });
});
