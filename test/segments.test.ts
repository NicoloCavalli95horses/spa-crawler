import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractSegments, spliceSegment } from '../src/analysis/segments';

describe('extractSegments', () => {
  it('extracts every path segment as a candidate', () => {
    const candidates = extractSegments({ url: 'https://a.test/api/users/42' });
    assert.deepEqual(candidates, [
      { parts: ['https://a.test/', '/users/42'], value: 'api', index: 1, query: '' },
      { parts: ['https://a.test/api/', '/42'], value: 'users', index: 1, query: '' },
      { parts: ['https://a.test/api/users/', ''], value: '42', index: 1, query: '' },
    ]);
  });

  it('keeps an id segment at the start of a long path', () => {
    const values = extractSegments({ url: 'https://a.test/users/42/profile/settings/privacy/notifications/email' }).map((c) => c.value);
    assert.deepEqual(values, ['users', '42', 'profile', 'settings', 'privacy', 'notifications', 'email']);
  });

  it('returns no path candidates for the root path', () => {
    assert.deepEqual(extractSegments({ url: 'https://a.test/' }), []);
  });

  it('extracts query params as separate candidates, excluding true/false and the path value', () => {
    const candidates = extractSegments({ url: 'https://a.test/api/items?id=42&active=true' });
    assert.deepEqual(candidates, [
      { parts: ['https://a.test/', '/items'], value: 'api', index: 1, query: '?id=42&active=true' },
      { parts: ['https://a.test/api/', ''], value: 'items', index: 1, query: '?id=42&active=true' },
      { parts: ['https://a.test/api/items?id='], value: '42', index: 1, paramName: 'id' },
    ]);
  });

  it('keeps the file extension on the suffix side when the segment has one', () => {
    const candidate = extractSegments({ url: 'https://a.test/files/report.pdf' }).at(-1);
    assert.deepEqual(candidate, { parts: ['https://a.test/files/', '.pdf'], value: 'report', index: 1, query: '' });
  });
});

describe('spliceSegment', () => {
  it('inserts the value between prefix/suffix and re-attaches the query string', () => {
    const url = spliceSegment({ parts: ['https://a.test/users/', '/profile'], index: 1, value: '99', query: '?x=1' });
    assert.equal(url, 'https://a.test/users/99/profile?x=1');
  });

  it('appends the value for a single-part query candidate (no query re-attachment)', () => {
    const url = spliceSegment({ parts: ['https://a.test/items?id='], index: 1, value: '99' });
    assert.equal(url, 'https://a.test/items?id=99');
  });
});
