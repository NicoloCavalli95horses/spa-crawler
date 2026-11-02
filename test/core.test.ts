import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { snapRect } from '../src/core/geometry';
import { shortHash } from '../src/core/hash';
import { normalizeText } from '../src/core/text';

describe('snapRect', () => {
  it('snaps every side to the grid', () => {
    assert.deepEqual(snapRect({ x: 9.9, y: 13.2, width: 57.3, height: 17 }, 4),
      { x: 8, y: 12, width: 56, height: 16 });
  });
  it('absorbs sub-pixel differences', () => {
    assert.deepEqual(snapRect({ x: 100.2, y: 50, width: 10, height: 10 }, 4),
      snapRect({ x: 100.6, y: 50, width: 10, height: 10 }, 4));
  });
});

describe('shortHash', () => {
  it('is deterministic and has the requested length', () => {
    assert.equal(shortHash('abc'), shortHash('abc'));
    assert.notEqual(shortHash('abc'), shortHash('abd'));
    assert.equal(shortHash('abc', 8).length, 8);
  });
});

describe('normalizeText', () => {
  it('lowercases and collapses whitespace', () => {
    assert.equal(normalizeText('  Ciao\n   MONDO '), 'ciao mondo');
  });
  it('replaces digits, so counters and dates do not change the text', () => {
    assert.equal(normalizeText('Carrello (3)'), normalizeText('Carrello (12)'));
    assert.equal(normalizeText('Aggiornato 10:42'), 'aggiornato #:#');
  });
  it('handles missing values', () => {
    assert.equal(normalizeText(undefined), '');
    assert.equal(normalizeText(null), '');
  });
});
