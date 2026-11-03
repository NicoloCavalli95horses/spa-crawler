import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { StateGraph } from '../src/state/StateGraph';
import { CrawlEdgeStore } from '../src/db/CrawlEdgeStore';
import { descriptor } from './helpers/fakes';

let root: string;
before(async () => { root = await mkdtemp(join(tmpdir(), 'crawler-test-')); });
after(async () => { await rm(root, { recursive: true, force: true }); });

let n = 0;
function newGraph(site = 'a.test'): { graph: StateGraph; persistent: CrawlEdgeStore } {
  const persistent = new CrawlEdgeStore({ db: new Database(join(root, `${n++}.db`)), clearOnStart: false });
  return { graph: new StateGraph(site, persistent), persistent };
}

const click = (id: string) => ({ type: 'click' as const, target: descriptor(id) });

describe('StateGraph', () => {
  it('records edges with the action data', () => {
    const { graph } = newGraph();
    graph.addEdge('S0', click('a'), 'S1');
    assert.equal(graph.edgeCount(), 1);
    assert.deepEqual(graph.getEdges()[0], {
      from: 'S0', to: 'S1',
      action: { type: 'click', targetId: 'a', text: 'a', selector: '#a' },
    });
  });

  it('does not duplicate the same edge', () => {
    const { graph } = newGraph();
    graph.addEdge('S0', click('a'), 'S1');
    graph.addEdge('S0', click('a'), 'S1');
    assert.equal(graph.edgeCount(), 1);
  });

  it('keeps edges that differ by destination or element', () => {
    const { graph } = newGraph();
    graph.addEdge('S0', click('a'), 'S1');
    graph.addEdge('S0', click('a'), 'S2');
    graph.addEdge('S0', click('b'), 'S1');
    assert.equal(graph.edgeCount(), 3);
  });

  it('persist saves only the edges not yet persisted', async () => {
    const { graph, persistent } = newGraph('grafo.test');
    graph.addEdge('S0', click('a'), 'S1');
    await graph.persist();
    assert.equal(persistent.count('grafo.test'), 1);

    graph.addEdge('S1', click('b'), 'S2');
    await graph.persist();
    assert.equal(persistent.count('grafo.test'), 2);

    // nothing new since the last persist: no-op, not a re-insert
    await graph.persist();
    assert.equal(persistent.count('grafo.test'), 2);
  });
});
