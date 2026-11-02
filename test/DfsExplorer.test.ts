import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DfsExplorer, type ExplorationLimits } from '../src/core/DfsExplorer';
import { StateNavigator } from '../src/browser/StateNavigator';
import { StateStore } from '../src/state/StateStore';
import { StateGraph } from '../src/state/StateGraph';
import type { IStateCapturer } from '../src/core/interfaces';
import { FakeApp, FakeTabs, MemoryOutput, noWait } from './helpers/fakes';

/** Real engine (navigator, store, graph) on a simulated app. */
function run(app: FakeApp, limits: Partial<ExplorationLimits> = {}, capturer?: IStateCapturer) {
  const out = new MemoryOutput();
  const cap = capturer ?? app.capturer();
  const executor = app.executor();
  const navigator = new StateNavigator('https://app.test/', executor, noWait, cap);
  const store = new StateStore({ screenshots: false }, out);
  const graph = new StateGraph(out);
  const explorer = new DfsExplorer(noWait, executor, cap, navigator, store, graph,
    { maxDepth: 10, maxStates: 1000, maxDurationSecs: 3600, ...limits });
  const saved = () => out.states.map((s) => s.id).sort();
  return { explorer, out, graph, saved, explore: () => explorer.explore(app.page()) };
}

describe('DfsExplorer', () => {
  it('visits all reachable states, even with cycles', async () => {
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

  it('saves states at the maximum depth but does not expand them', async () => {
    const app = new FakeApp({ S0: { a: 'S1' }, S1: { b: 'S2' }, S2: { c: 'S3' }, S3: {} });
    const r = run(app, { maxDepth: 2 });
    await r.explore();
    assert.deepEqual(r.saved(), ['S0', 'S1', 'S2']);
  });

  it('records depth and path of every state', async () => {
    const app = new FakeApp({ S0: { a: 'S1' }, S1: { b: 'S2' }, S2: {} });
    const r = run(app);
    await r.explore();
    const s2 = r.out.states.find((s) => s.id === 'S2')!;
    assert.equal(s2.depth, 2);
    assert.deepEqual(s2.path.map((p) => p.targetId), ['a', 'b']);
  });

  it('after the maximum depth goes back to the starting state and tries the next clickable', async () => {
    const app = new FakeApp({ S0: { a: 'S1', b: 'S2' }, S1: { c: 'S3' }, S2: {}, S3: {} });
    const r = run(app, { maxDepth: 1 });
    await r.explore();
    assert.deepEqual(app.clicks, ['S0.a', 'S0.b']);
    assert.deepEqual(r.saved(), ['S0', 'S1', 'S2']);
  });

  it('does not re-expand an already seen state', async () => {
    const app = new FakeApp({ S0: { a: 'S1', b: 'S1' }, S1: { c: 'S2' }, S2: {} });
    const r = run(app);
    await r.explore();
    assert.equal(app.clicks.filter((c) => c === 'S1.c').length, 1);
    assert.equal(r.graph.edgeCount(), 3);   // S0-a->S1, S0-b->S1, S1-c->S2
  });

  it('stops at the maximum number of states', async () => {
    const app = new FakeApp({ S0: { a: 'S1', b: 'S2', c: 'S3' }, S1: {}, S2: {}, S3: {} });
    const r = run(app, { maxStates: 2 });
    await r.explore();
    assert.equal(r.out.states.length, 2);
  });

  it('stops when the time budget is exhausted', async () => {
    const app = new FakeApp({ S0: { a: 'S1', b: 'S2' }, S1: {}, S2: {} });
    const r = run(app, { maxDurationSecs: 0 });
    await r.explore();
    assert.deepEqual(r.saved(), ['S0']);
  });

  it('an error on one element does not stop the others', async () => {
    const app = new FakeApp({ S0: { a: 'THROW', b: 'S1' }, S1: {} });
    const r = run(app);
    await r.explore();
    assert.deepEqual(r.saved(), ['S0', 'S1']);
  });

  it('saves the graph even if the exploration fails', async () => {
    const app = new FakeApp({ S0: {} });
    const broken: IStateCapturer = { capture: async () => { throw new Error('pagina rotta'); } };
    const r = run(app, {}, broken);
    await assert.rejects(r.explore(), /pagina rotta/);
    assert.ok(r.out.json.has('state-graph'));
  });

  it('calls beforeAction before each click and afterAction on each result', async () => {
    const app = new FakeApp({ S0: { a: 'S1', b: 'S2' }, S1: {}, S2: {} });
    const out = new MemoryOutput();
    const cap = app.capturer();
    const executor = app.executor();
    const navigator = new StateNavigator('https://app.test/', executor, noWait, cap);
    const order: string[] = [];
    const hooks = {
      onStart: async () => {},
      onEnd: async () => {},
      beforeAction: async () => { order.push('before'); },
      afterAction: async () => { order.push('after'); },
    };
    const explorer = new DfsExplorer(
      noWait, executor, cap, navigator, new StateStore({ screenshots: false }, out), new StateGraph(out),
      { maxDepth: 10, maxStates: 1000, maxDurationSecs: 3600 }, hooks,
    );

    await explorer.explore(app.page());

    // S0 has two clickables (S1, S2 have none): each click is wrapped before -> after, in order
    assert.deepEqual(order, ['before', 'after', 'before', 'after']);
    assert.deepEqual(out.states.map((s) => s.id).sort(), ['S0', 'S1', 'S2']);
  });

  describe('multiple tabs', () => {
    const GRAPH = {
      S0: { a: 'S1', b: 'S2', c: 'S3' },
      S1: { d: 'S4', e: 'S5' },
      S2: { f: 'S5', g: 'S6' },
      S3: { h: 'S6' },
      S4: { back: 'S0' }, S5: {}, S6: { x: 'S7' }, S7: {},
    };

    function runTabs(tabs: FakeTabs, limits: Partial<ExplorationLimits> = {}) {
      const out = new MemoryOutput();
      const cap = tabs.capturer();
      const executor = tabs.executor();
      const navigator = new StateNavigator('https://app.test/', executor, noWait, cap);
      const explorer = new DfsExplorer(noWait, executor, cap, navigator,
        new StateStore({ screenshots: false }, out), new StateGraph(out),
        { maxDepth: 10, maxStates: 1000, maxDurationSecs: 3600, ...limits });
      const [first, ...rest] = tabs.pages();
      return { out, explore: () => explorer.explore(first, rest) };
    }

    it('find the same states as a single tab, without saving any twice', async () => {
      const tabs = new FakeTabs(GRAPH, 3);
      const r = runTabs(tabs);
      await r.explore();
      const ids = r.out.states.map((s) => s.id).sort();
      assert.deepEqual(ids, ['S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7']);
    });

    it('split the work', async () => {
      const tabs = new FakeTabs(GRAPH, 3);
      await runTabs(tabs).explore();
      const clicks = tabs.clicks;
      assert.ok(clicks.length > 0);
      assert.ok([0, 1, 2].filter((i) => tabs.clicksOf(i).length > 0).length >= 2, 'work must be split across the tabs');
    });

    it('maxStates applies to each tab', async () => {
      const tabs = new FakeTabs(GRAPH, 2);
      const r = runTabs(tabs, { maxStates: 2 });
      await r.explore();
      assert.ok(r.out.states.length <= 4, `saved ${r.out.states.length}`);
      assert.ok(r.out.states.length > 2, 'with two tabs we go past the cap of a single one');
    });

    it('respect the maximum depth', async () => {
      const tabs = new FakeTabs(GRAPH, 3);
      const r = runTabs(tabs, { maxDepth: 1 });
      await r.explore();
      assert.deepEqual(r.out.states.map((s) => s.id).sort(), ['S0', 'S1', 'S2', 'S3']);
    });

    it('terminate even when there are more tabs than work', async () => {
      const tabs = new FakeTabs({ S0: { a: 'S1' }, S1: {} }, 5);
      const r = runTabs(tabs);
      await r.explore();
      assert.deepEqual(r.out.states.map((s) => s.id).sort(), ['S0', 'S1']);
    });
  });
});
