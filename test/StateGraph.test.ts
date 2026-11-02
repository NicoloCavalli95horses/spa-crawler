import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StateGraph } from '../src/state/StateGraph';
import { MemoryOutput, descriptor } from './helpers/fakes';

const click = (id: string) => ({ type: 'click' as const, target: descriptor(id) });

describe('StateGraph', () => {
  it('records edges with the action data', () => {
    const g = new StateGraph(new MemoryOutput());
    g.addEdge('S0', click('a'), 'S1');
    assert.equal(g.edgeCount(), 1);
    assert.deepEqual(g.getEdges()[0], {
      from: 'S0', to: 'S1',
      action: { type: 'click', targetId: 'a', text: 'a', selector: '#a' },
    });
  });

  it('does not duplicate the same edge', () => {
    const g = new StateGraph(new MemoryOutput());
    g.addEdge('S0', click('a'), 'S1');
    g.addEdge('S0', click('a'), 'S1');
    assert.equal(g.edgeCount(), 1);
  });

  it('keeps edges that differ by destination or element', () => {
    const g = new StateGraph(new MemoryOutput());
    g.addEdge('S0', click('a'), 'S1');
    g.addEdge('S0', click('a'), 'S2');
    g.addEdge('S0', click('b'), 'S1');
    assert.equal(g.edgeCount(), 3);
  });

  it('persist saves the edges as JSON under the configured key', async () => {
    const out = new MemoryOutput();
    const g = new StateGraph(out, 'grafo');
    g.addEdge('S0', click('a'), 'S1');
    await g.persist();
    assert.deepEqual(out.json.get('grafo'), { edges: g.getEdges() });
  });
});
