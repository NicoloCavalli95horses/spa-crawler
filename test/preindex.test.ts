import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isKeyMatch, isInteresting, tokenize, collectPreindexRows } from '../src/analysis/preindex';

describe('preindex', () => {
  describe('isKeyMatch', () => {
    it('matches exact and camelCase keys against the preindexed-keys list', () => {
      assert.equal(isKeyMatch('id'), true);
      assert.equal(isKeyMatch('userId'), true);
      assert.equal(isKeyMatch('isPremium'), false); // "premium" isn't in the list, only "permission"/"role" etc.
      assert.equal(isKeyMatch('role'), true);
      assert.equal(isKeyMatch(''), false);
    });
  });

  describe('isInteresting', () => {
    it('rejects non-matching keys, whitespace, brackets, and out-of-range lengths', () => {
      assert.equal(isInteresting('title', 'hello'), true);
      assert.equal(isInteresting('color', 'hello'), false);     // key doesn't match
      assert.equal(isInteresting('title', 'has space'), false); // whitespace
      assert.equal(isInteresting('title', '[redacted]'), false); // bracketed
      assert.equal(isInteresting('title', 'x'), false);          // too short
      assert.equal(isInteresting('title', null), false);
    });

    it('accepts finite numbers for matching keys only', () => {
      assert.equal(isInteresting('id', 42), true);
      assert.equal(isInteresting('id', NaN), false);
      assert.equal(isInteresting('color', 42), false);
    });
  });

  describe('tokenize', () => {
    it('splits on / . ? and trims/filters empties', () => {
      assert.deepEqual(tokenize('users/42'), ['users', '42']);
      assert.deepEqual(tokenize('a.b?c'), ['a', 'b', 'c']);
      assert.deepEqual(tokenize('plain'), ['plain']);
    });
  });

  describe('collectPreindexRows', () => {
    it('indexes an interesting node key (raw, untokenized) and interesting prop leaves (tokenized)', () => {
      const rows = collectPreindexRows({
        nodeId: 'n1',
        key: 'users/42',
        props: { id: 'users/42', title: 'ok', color: 'red' },
      });
      assert.deepEqual(rows, [
        { nodeId: 'n1', value: 'users/42', path: ['key'], depth: 0 },
        { nodeId: 'n1', value: 'users', path: ['props', 'id'], depth: 2 },
        { nodeId: 'n1', value: '42', path: ['props', 'id'], depth: 2 },
        { nodeId: 'n1', value: 'ok', path: ['props', 'title'], depth: 2 },
      ]);
    });

    it('walks nested props up to depth 4 (path length, counting "props" itself)', () => {
      const withinLimit = collectPreindexRows({ nodeId: 'n2', props: { a: { b: { id: 'deep-id' } } } });
      assert.deepEqual(withinLimit, [{ nodeId: 'n2', value: 'deep-id', path: ['props', 'a', 'b', 'id'], depth: 4 }]);

      // one level deeper puts the leaf's path length (5) past maxDepth (4): never visited
      const beyondLimit = collectPreindexRows({ nodeId: 'n2', props: { a: { b: { c: { id: 'deep-id' } } } } });
      assert.deepEqual(beyondLimit, []);
    });
  });
});
