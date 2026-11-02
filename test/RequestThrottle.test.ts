import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RequestThrottle } from '../src/browser/RequestThrottle';

describe('RequestThrottle', () => {
  it('spaces concurrent waits at least the delay apart', async () => {
    const throttle = new RequestThrottle(40);
    const times: number[] = [];
    await Promise.all([1, 2, 3].map(async () => { await throttle.wait(); times.push(Date.now()); }));
    times.sort((a, b) => a - b);
    assert.ok(times[1] - times[0] >= 35, `gap ${times[1] - times[0]}`);
    assert.ok(times[2] - times[1] >= 35, `gap ${times[2] - times[1]}`);
  });

  it('the first request does not wait', async () => {
    const start = Date.now();
    await new RequestThrottle(500).wait();
    assert.ok(Date.now() - start < 100);
  });
});
