import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SegmentExtractor, spliceSegment } from '../src/analysis/segments';

describe('SegmentExtractor', () => {
  it('extracts a trailing window of path segments as candidates by default (no history yet)', () => {
    // 3 segments -> trailing window of 2 ("users", "42"), no history yet to add a 3rd signal
    const candidates = new SegmentExtractor().extract('https://a.test/api/users/42');
    assert.deepEqual(candidates, [
      { parts: ['https://a.test/api/', '/42'], value: 'users', index: 1, query: '' },
      { parts: ['https://a.test/api/users/', ''], value: '42', index: 1, query: '' },
    ]);
  });

  it('learns which segment varies across requests with the same shape, union\'d with the trailing window', () => {
    const extractor = new SegmentExtractor();
    extractor.extract('https://a.test/api/users/42/profile');
    const candidates = extractor.extract('https://a.test/api/users/43/profile');
    const byValue = Object.fromEntries(candidates.map((c) => [c.value, c]));
    assert.equal(byValue['43'].parts.join(''), 'https://a.test/api/users//profile');
  });

  it('proposes more trailing candidates for longer paths, fewer for short ones', () => {
    const short = new SegmentExtractor().extract('https://a.test/dashboard');
    assert.equal(short.length, 1); // 1 segment -> window of ceil(1/2) = 1

    const medium = new SegmentExtractor().extract('https://a.test/course/start/objective_abc');
    assert.equal(medium.length, 2); // 3 segments -> window of ceil(3/2) = 2

    const long = new SegmentExtractor().extract('https://a.test/dashboard/learning/course/start/objective_abc/activity_def/exercise_1');
    assert.equal(long.length, 4); // 7 segments -> window of ceil(7/2) = 4

    const veryLong = new SegmentExtractor().extract('https://a.test/a/b/c/d/e/f/g/h/i/j/k'); // 11 segments -> ceil(11/2) = 6, capped at 5
    assert.equal(veryLong.length, 5);
  });

  it('keeps an id-shaped segment inside the window even when extra prefix segments push it further from the end', () => {
    // regression: busuu's .../course/start/objective_<uuid>/0_0_0_<hex>/activity_<uuid>/exercise_1 (8
    // segments) used to drop objective_<uuid> (index 4) entirely — a hardcoded window of 3 only ever
    // reached indexes 5-7, and no amount of request history could rescue it either, since objective
    // and the derived 0_0_0_<hex> segment next to it always change together (never the sole differing
    // index). The proportional window (ceil(8/2) = 4) now reaches index 4.
    const url = 'https://a.test/dashboard/learning/course/start/objective_abc-123/0_0_0_abc123/activity_def/exercise_1';
    const candidates = new SegmentExtractor().extract(url);
    assert.ok(candidates.some((c) => c.value === 'objective_abc-123'), `expected an "objective_abc-123" candidate, got: ${JSON.stringify(candidates.map((c) => c.value))}`);
  });

  it('extracts query params as separate candidates, excluding true/false and the path value', () => {
    const candidates = new SegmentExtractor().extract('https://a.test/api/items?id=42&active=true');
    assert.deepEqual(candidates, [
      { parts: ['https://a.test/api/', ''], value: 'items', index: 1, query: '?id=42&active=true' },
      { parts: ['https://a.test/api/items?id='], value: '42', index: 1, paramName: 'id' },
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
