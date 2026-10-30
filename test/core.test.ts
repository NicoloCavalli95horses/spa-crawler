import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { snapRect } from '../src/core/geometry';
import { shortHash } from '../src/core/hash';
import { normalizeText } from '../src/core/text';

describe('snapRect', () => {
  it('arrotonda ogni lato alla griglia', () => {
    assert.deepEqual(snapRect({ x: 9.9, y: 13.2, width: 57.3, height: 17 }, 4),
      { x: 8, y: 12, width: 56, height: 16 });
  });
  it('assorbe differenze sub-pixel', () => {
    assert.deepEqual(snapRect({ x: 100.2, y: 50, width: 10, height: 10 }, 4),
      snapRect({ x: 100.6, y: 50, width: 10, height: 10 }, 4));
  });
});

describe('shortHash', () => {
  it('è deterministico e della lunghezza richiesta', () => {
    assert.equal(shortHash('abc'), shortHash('abc'));
    assert.notEqual(shortHash('abc'), shortHash('abd'));
    assert.equal(shortHash('abc', 8).length, 8);
  });
});

describe('normalizeText', () => {
  it('rende minuscolo e compatta gli spazi', () => {
    assert.equal(normalizeText('  Ciao\n   MONDO '), 'ciao mondo');
  });
  it('sostituisce le cifre, così contatori e date non cambiano il testo', () => {
    assert.equal(normalizeText('Carrello (3)'), normalizeText('Carrello (12)'));
    assert.equal(normalizeText('Aggiornato 10:42'), 'aggiornato #:#');
  });
  it('gestisce valori assenti', () => {
    assert.equal(normalizeText(undefined), '');
    assert.equal(normalizeText(null), '');
  });
});
