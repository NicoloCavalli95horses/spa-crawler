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

  it('copies selector, tag, rectangle and text into the descriptor', () => {
    const d = withText.build(raw());
    assert.equal(d.selector, 'body > button:nth-of-type(1)');
    assert.equal(d.tag, 'button');
    assert.deepEqual(d.rect, { x: 10, y: 20, width: 80, height: 24 });
    assert.equal(d.text, 'Salva');
  });

  it('uses aria-label when the text is missing', () => {
    assert.equal(withText.build(raw({ text: undefined, ariaLabel: 'Chiudi' })).text, 'Chiudi');
  });

  it('gives the same id despite sub-pixel differences', () => {
    assert.equal(withText.build(raw()).id,
      withText.build(raw({ rect: { x: 10.4, y: 19.7, width: 80.2, height: 24 } })).id);
  });

  it('changes id when the rectangle moves past the grid', () => {
    assert.notEqual(withText.build(raw()).id,
      withText.build(raw({ rect: { x: 30, y: 20, width: 80, height: 24 } })).id);
  });

  it('changes id with a different tag or fixed positioning', () => {
    assert.notEqual(withText.build(raw()).id, withText.build(raw({ tag: 'a' })).id);
    assert.notEqual(withText.build(raw()).id, withText.build(raw({ fixed: true })).id);
  });

  it('ignores the selector and DOM attributes', () => {
    assert.equal(withText.build(raw()).id,
      withText.build(raw({ cssPath: 'body > div:nth-of-type(3) > button:nth-of-type(1)' })).id);
  });

  it('with includeText tells apart elements with different text', () => {
    assert.notEqual(withText.build(raw()).id, withText.build(raw({ text: 'Annulla' })).id);
  });

  it('with includeText ignores digits in the text', () => {
    assert.equal(withText.build(raw({ text: 'Carrello (3)' })).id,
      withText.build(raw({ text: 'Carrello (4)' })).id);
  });

  it('without includeText the text does not matter', () => {
    assert.equal(noText.build(raw()).id, noText.build(raw({ text: 'Annulla' })).id);
  });
});
