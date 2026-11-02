import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StateFingerprinter } from '../src/state/StateFingerprinter';
import type { FingerprintInput } from '../src/core/interfaces';
import { descriptor } from './helpers/fakes';

const input = (over: Partial<FingerprintInput> = {}): FingerprintInput => ({
  url: 'https://app.test/home#tab1',
  clickables: [descriptor('a'), descriptor('b')],
  texts: ['Benvenuto', 'Hai 3 notifiche'],
  ...over,
});

describe('StateFingerprinter', () => {
  const full = new StateFingerprinter({ includeUrl: true, includePageText: true });
  const bare = new StateFingerprinter({ includeUrl: false, includePageText: false });

  it('is deterministic', () => {
    assert.equal(full.fingerprint(input()), full.fingerprint(input()));
  });

  it('does not depend on the order of clickables and texts', () => {
    assert.equal(full.fingerprint(input()), full.fingerprint(input({
      clickables: [descriptor('b'), descriptor('a')],
      texts: ['Hai 3 notifiche', 'Benvenuto'],
    })));
  });

  it('ignores duplicate clickables', () => {
    assert.equal(full.fingerprint(input()),
      full.fingerprint(input({ clickables: [descriptor('a'), descriptor('b'), descriptor('a')] })));
  });

  it('changes when a clickable changes', () => {
    assert.notEqual(full.fingerprint(input()),
      full.fingerprint(input({ clickables: [descriptor('a'), descriptor('c')] })));
  });

  it('with includeUrl tells apart pathname and hash, but not the query', () => {
    assert.notEqual(full.fingerprint(input()), full.fingerprint(input({ url: 'https://app.test/other#tab1' })));
    assert.notEqual(full.fingerprint(input()), full.fingerprint(input({ url: 'https://app.test/home#tab2' })));
    assert.equal(full.fingerprint(input()), full.fingerprint(input({ url: 'https://app.test/home?utm=x#tab1' })));
  });

  it('without includeUrl ignores the URL', () => {
    assert.equal(bare.fingerprint(input()), bare.fingerprint(input({ url: 'https://app.test/other' })));
  });

  it('with includePageText tells apart different contents with the same layout', () => {
    assert.notEqual(full.fingerprint(input()), full.fingerprint(input({ texts: ['Prodotto A'] })));
  });

  it('with includePageText ignores digits, case and whitespace', () => {
    assert.equal(full.fingerprint(input()),
      full.fingerprint(input({ texts: ['  BENVENUTO ', 'Hai 15 notifiche'] })));
  });

  it('without includePageText ignores the texts', () => {
    assert.equal(bare.fingerprint(input()), bare.fingerprint(input({ texts: ['altro'] })));
  });
});
