import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SelectorBuilder } from '../src/extraction/SelectorBuilder';
import type { RawElement } from '../src/extraction/browser/collectCandidates';

const raw = (over: Partial<RawElement> = {}): RawElement => ({
  tag: 'button', cssPath: 'body > button:nth-of-type(1)', fixed: false, text: 'Salva',
  rect: { x: 10, y: 20, width: 80, height: 24 }, ...over,
});

describe('SelectorBuilder', () => {
  const withText = new SelectorBuilder({ gridPx: 4, includeText: true });
  const noText = new SelectorBuilder({ gridPx: 4, includeText: false });

  it('copia selettore, tag, rettangolo e testo nel descrittore', () => {
    const d = withText.build(raw());
    assert.equal(d.selector, 'body > button:nth-of-type(1)');
    assert.equal(d.tag, 'button');
    assert.deepEqual(d.rect, { x: 10, y: 20, width: 80, height: 24 });
    assert.equal(d.text, 'Salva');
  });

  it('usa aria-label quando manca il testo', () => {
    assert.equal(withText.build(raw({ text: undefined, ariaLabel: 'Chiudi' })).text, 'Chiudi');
  });

  it('dà lo stesso id a differenze sub-pixel', () => {
    assert.equal(withText.build(raw()).id,
      withText.build(raw({ rect: { x: 10.4, y: 19.7, width: 80.2, height: 24 } })).id);
  });

  it('cambia id se il rettangolo si sposta oltre la griglia', () => {
    assert.notEqual(withText.build(raw()).id,
      withText.build(raw({ rect: { x: 30, y: 20, width: 80, height: 24 } })).id);
  });

  it('cambia id con tag o posizionamento fixed diversi', () => {
    assert.notEqual(withText.build(raw()).id, withText.build(raw({ tag: 'a' })).id);
    assert.notEqual(withText.build(raw()).id, withText.build(raw({ fixed: true })).id);
  });

  it('ignora selettore e attributi del DOM', () => {
    assert.equal(withText.build(raw()).id,
      withText.build(raw({ cssPath: 'body > div:nth-of-type(3) > button:nth-of-type(1)' })).id);
  });

  it('con includeText distingue elementi con testo diverso', () => {
    assert.notEqual(withText.build(raw()).id, withText.build(raw({ text: 'Annulla' })).id);
  });

  it('con includeText ignora le cifre nel testo', () => {
    assert.equal(withText.build(raw({ text: 'Carrello (3)' })).id,
      withText.build(raw({ text: 'Carrello (4)' })).id);
  });

  it('senza includeText il testo non conta', () => {
    assert.equal(noText.build(raw()).id, noText.build(raw({ text: 'Annulla' })).id);
  });
});
