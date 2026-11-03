import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readPath, diffValue, findCandidates } from '../src/analysis/matchFinder';
import type { RapidorGraph } from '../src/db/ReactStateStore';

describe('readPath', () => {
  it('walks a path into an object, undefined on a missing or non-object step', () => {
    assert.equal(readPath({ props: { id: '42' } }, ['props', 'id']), '42');
    assert.equal(readPath({ props: { id: '42' } }, ['props', 'missing']), undefined);
    assert.equal(readPath({ props: 'not-an-object' }, ['props', 'id']), undefined);
  });
});

describe('diffValue', () => {
  it('extracts the single differing token between two tokenized strings', () => {
    assert.equal(diffValue({ referenceRaw: 'users/42', candidateRaw: 'users/43' }), '43');
  });

  it('returns undefined when there is no diff, or more than one', () => {
    assert.equal(diffValue({ referenceRaw: 'users/42', candidateRaw: 'users/42' }), undefined);
    assert.equal(diffValue({ referenceRaw: 'a/b', candidateRaw: 'c/d' }), undefined);
  });

  it('falls back to straight inequality for non-string values', () => {
    assert.equal(diffValue({ referenceRaw: 42, candidateRaw: 43 }), '43');
    assert.equal(diffValue({ referenceRaw: 42, candidateRaw: 42 }), undefined);
  });

  it('is undefined when the candidate value is missing', () => {
    assert.equal(diffValue({ referenceRaw: '42', candidateRaw: undefined }), undefined);
  });
});

describe('findCandidates', () => {
  const graph: RapidorGraph = {
    fingerprint: 'f',
    nodes: {
      'node-1': { id: 'node-1', componentId: 1, props: { id: 'free-id', premium: false } },
      'node-2': { id: 'node-2', componentId: 1, props: { id: 'premium-id', premium: true } },
      'node-3': { id: 'node-3', componentId: 2, props: { id: 'other-component' } },
    },
    componentIndex: { '1': ['node-1', 'node-2'] },
  };

  it('finds a sibling instance with a different value at the same path', () => {
    const candidates = findCandidates({ stateId: 1, graph, nodeId: 'node-1', path: ['props', 'id'] });
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].candidateNodeId, 'node-2');
    assert.equal(candidates[0].candidateValue, 'premium-id');
    assert.deepEqual(candidates[0].referenceProps, { id: 'free-id', premium: false });
    assert.deepEqual(candidates[0].candidateProps, { id: 'premium-id', premium: true });
  });

  it('is empty for an orphan node (no componentId) or a component with no recorded instances', () => {
    assert.deepEqual(findCandidates({ stateId: 1, graph, nodeId: 'node-3', path: ['props', 'id'] }), []);
    const lonely: RapidorGraph = { fingerprint: 'f', nodes: graph.nodes, componentIndex: { '2': ['node-3'] } };
    assert.deepEqual(findCandidates({ stateId: 1, graph: lonely, nodeId: 'node-3', path: ['props', 'id'] }), []);
  });

  it('is empty when the reference value itself cannot be read at that path', () => {
    assert.deepEqual(findCandidates({ stateId: 1, graph, nodeId: 'node-1', path: ['props', 'missing'] }), []);
  });
});
