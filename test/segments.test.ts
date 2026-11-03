import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SegmentExtractor, spliceSegment } from '../src/analysis/segments';

describe('SegmentExtractor', () => {
  it('extracts the last path segment as a candidate by default (no history yet)', () => {
    const candidates = new SegmentExtractor().extract('https://a.test/api/users/42');
    assert.deepEqual(candidates, [{ parts: ['https://a.test/api/users/', ''], value: '42', index: 1, query: '' }]);
  });

  it('learns which segment varies across requests with the same shape', () => {
    const extractor = new SegmentExtractor();
    extractor.extract('https://a.test/api/users/42/profile');
    const candidates = extractor.extract('https://a.test/api/users/43/profile');
    assert.equal(candidates[0].value, '43');
    assert.deepEqual(candidates[0].parts, ['https://a.test/api/users/', '/profile']);
  });

  it('extracts query params as separate candidates, excluding true/false and the path value', () => {
    const candidates = new SegmentExtractor().extract('https://a.test/api/items?id=42&active=true');
    assert.deepEqual(candidates, [
      { parts: ['https://a.test/api/', ''], value: 'items', index: 1, query: '?id=42&active=true' },
      { parts: ['https://a.test/api/items?id='], value: '42', index: 1 },
    ]);
  });

  it('keeps the file extension on the suffix side when the segment has one', () => {
    const candidates = new SegmentExtractor().extract('https://a.test/files/report.pdf');
    assert.deepEqual(candidates[0], { parts: ['https://a.test/files/', '.pdf'], value: 'report', index: 1, query: '' });
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
