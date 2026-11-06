import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { findJsonMatches, findJsonCandidates, buildJsonPreindex } from '../src/analysis/jsonMatchFinder';

describe('findJsonMatches', () => {
  it('finds a leaf whose key matches a preindexed key and whose tokenized value includes the target', () => {
    const root = { users: [{ id: 'free-id', premium: false }, { id: 'premium-id', premium: true }] };
    assert.deepEqual(findJsonMatches({ root, value: 'free-id' }), [{ path: ['users', 0, 'id'] }]);
  });

  it('ignores a leaf whose key is not preindex-interesting (e.g. an unrelated boolean)', () => {
    const root = { users: [{ id: 'x', active: true }] };
    assert.deepEqual(findJsonMatches({ root, value: 'true' }), []);
  });

  it('matches a numeric value too (tokenized via String(), same as preindex.ts)', () => {
    const root = { items: [{ id: 42 }, { id: 43 }] };
    assert.deepEqual(findJsonMatches({ root, value: '42' }), [{ path: ['items', 0, 'id'] }]);
  });
});

describe('findJsonCandidates', () => {
  it('finds a sibling array item with a different value at the same relative path', () => {
    const root = { users: [{ id: 'free-id', premium: false }, { id: 'premium-id', premium: true }] };
    const candidates = findJsonCandidates({ root, path: ['users', 0, 'id'] });
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].candidateValue, 'premium-id');
    assert.deepEqual(candidates[0].candidatePath, ['users', 1, 'id']);
    assert.deepEqual(candidates[0].referenceProps, { id: 'free-id', premium: false });
    assert.deepEqual(candidates[0].candidateProps, { id: 'premium-id', premium: true });
  });

  it('is empty when the matched leaf is not inside an array at all', () => {
    const root = { user: { id: 'solo' } };
    assert.deepEqual(findJsonCandidates({ root, path: ['user', 'id'] }), []);
  });

  it('is empty for a single-element array (no other sibling to diff against)', () => {
    const root = { users: [{ id: 'only-one' }] };
    assert.deepEqual(findJsonCandidates({ root, path: ['users', 0, 'id'] }), []);
  });

  it('is empty when the reference value itself cannot be read at that path', () => {
    const root = { users: [{}, { id: 'b' }] };
    assert.deepEqual(findJsonCandidates({ root, path: ['users', 0, 'id'] }), []);
  });

  it('finds siblings at EVERY enclosing array level, not just the nearest one', () => {
    const root = { pages: [{ items: [{ id: 'a' }, { id: 'b' }] }, { items: [{ id: 'c' }] }] };
    const candidates = findJsonCandidates({ root, path: ['pages', 0, 'items', 0, 'id'] });
    // two independent candidates: varying 'items' (innermost) alone, and varying 'pages' alone —
    // never both together (that would be a combinatorial walk, deliberately not what this does)
    const byPath = new Map(candidates.map((c) => [JSON.stringify(c.candidatePath), c.candidateValue]));
    assert.equal(candidates.length, 2);
    assert.equal(byPath.get(JSON.stringify(['pages', 0, 'items', 1, 'id'])), 'b');
    assert.equal(byPath.get(JSON.stringify(['pages', 1, 'items', 0, 'id'])), 'c');
  });

  it('varies exactly one array level per candidate — never combines two levels in the same candidate', () => {
    const root = { a: [{ b: [{ id: 'x' }, { id: 'y' }] }, { b: [{ id: 'z' }] }] };
    const candidates = findJsonCandidates({ root, path: ['a', 0, 'b', 0, 'id'] });
    // NOT present: ['a', 1, 'b', 1, 'id'] (varying both 'a' and 'b' at once)
    assert.ok(!candidates.some((c) => JSON.stringify(c.candidatePath) === JSON.stringify(['a', 1, 'b', 1, 'id'])));
  });
});

describe('buildJsonPreindex', () => {
  it('finds a value inside a DIFFERENT body than the one its own segment came from', () => {
    // mirrors the real case this exists for: a per-item endpoint's own response has no siblings at
    // all, but the SAME id also appears inside an unrelated listing endpoint's response, alongside
    // its real siblings.
    const perItemBody = { id: '101', title: 'Solo item, no siblings here' };
    const listingBody = { items: [{ id: '101', premium: false }, { id: '102', premium: true }] };
    const index = buildJsonPreindex({ bodies: [perItemBody, listingBody] });

    const hits = index.get('101');
    assert.ok(hits);
    assert.deepEqual(hits, [{ bodyIndex: 0, path: ['id'] }, { bodyIndex: 1, path: ['items', 0, 'id'] }]);

    // sibling-finding still only ever happens within ONE body — the listing's own, where the hit landed
    const candidates = findJsonCandidates({ root: listingBody, path: hits[1].path });
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].candidateValue, '102');
  });

  it('skips a body that is not JSON (undefined), without erroring', () => {
    const index = buildJsonPreindex({ bodies: [undefined, { id: '101' }] });
    assert.deepEqual(index.get('101'), [{ bodyIndex: 1, path: ['id'] }]);
  });

  it('is empty when no body contains anything interesting', () => {
    const index = buildJsonPreindex({ bodies: [{ active: true }, undefined] });
    assert.equal(index.size, 0);
  });
});
