import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { urlCarriesValue } from '../src/analysis/clientRouting';

describe('urlCarriesValue (boundary-aware network scoping)', () => {
  it('matches a whole path segment', () => {
    assert.equal(urlCarriesValue('https://api.test/lessons/294/content', '294'), true);
  });

  it('matches a whole query-param value', () => {
    assert.equal(urlCarriesValue('https://api.test/lesson?id=294', '294'), true);
  });

  it('does NOT match a value that is only a substring of a longer path segment', () => {
    // the real false-confirm: candidate "298" riding along inside the customer id "6140298"
    assert.equal(urlCarriesValue('https://api.test/customers/6140298/progress', '298'), false);
  });

  it('does NOT match a value that is only a substring of a query-param value', () => {
    assert.equal(urlCarriesValue('https://api.test/x?customer=6140298', '298'), false);
  });

  it('matches a percent-encoded path segment once decoded', () => {
    assert.equal(urlCarriesValue('https://api.test/items/a%20b/x', 'a b'), true);
  });

  it('returns false when the value appears nowhere', () => {
    assert.equal(urlCarriesValue('https://api.test/customers/6140298/progress', '294'), false);
  });

  it('falls back to a substring test for an unparseable URL', () => {
    assert.equal(urlCarriesValue('not a url 294 here', '294'), true);
  });
});
