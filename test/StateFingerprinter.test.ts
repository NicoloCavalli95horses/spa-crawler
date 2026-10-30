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

  it('è deterministico', () => {
    assert.equal(full.fingerprint(input()), full.fingerprint(input()));
  });

  it("non dipende dall'ordine di cliccabili e testi", () => {
    assert.equal(full.fingerprint(input()), full.fingerprint(input({
      clickables: [descriptor('b'), descriptor('a')],
      texts: ['Hai 3 notifiche', 'Benvenuto'],
    })));
  });

  it('ignora i cliccabili duplicati', () => {
    assert.equal(full.fingerprint(input()),
      full.fingerprint(input({ clickables: [descriptor('a'), descriptor('b'), descriptor('a')] })));
  });

  it('cambia se cambia un cliccabile', () => {
    assert.notEqual(full.fingerprint(input()),
      full.fingerprint(input({ clickables: [descriptor('a'), descriptor('c')] })));
  });

  it('con includeUrl distingue pathname e hash, ma non la query', () => {
    assert.notEqual(full.fingerprint(input()), full.fingerprint(input({ url: 'https://app.test/other#tab1' })));
    assert.notEqual(full.fingerprint(input()), full.fingerprint(input({ url: 'https://app.test/home#tab2' })));
    assert.equal(full.fingerprint(input()), full.fingerprint(input({ url: 'https://app.test/home?utm=x#tab1' })));
  });

  it('senza includeUrl ignora l\'URL', () => {
    assert.equal(bare.fingerprint(input()), bare.fingerprint(input({ url: 'https://app.test/other' })));
  });

  it('con includePageText distingue contenuti diversi a parità di layout', () => {
    assert.notEqual(full.fingerprint(input()), full.fingerprint(input({ texts: ['Prodotto A'] })));
  });

  it('con includePageText ignora cifre, maiuscole e spazi', () => {
    assert.equal(full.fingerprint(input()),
      full.fingerprint(input({ texts: ['  BENVENUTO ', 'Hai 15 notifiche'] })));
  });

  it('senza includePageText ignora i testi', () => {
    assert.equal(bare.fingerprint(input()), bare.fingerprint(input({ texts: ['altro'] })));
  });
});
