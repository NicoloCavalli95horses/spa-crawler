import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NetworkObserverHooks } from '../src/browser/NetworkObserverHooks';
import { NetworkObserver } from '../src/browser/NetworkObserver';
import { MemoryOutput } from './helpers/fakes';

describe('NetworkObserverHooks', () => {
  it('saves the observer snapshot under "network-observer" on end', async () => {
    const out = new MemoryOutput();
    const observer = new NetworkObserver({ origin: 'https://app.test' });
    const hooks = new NetworkObserverHooks(observer, out);

    await hooks.onEnd();

    assert.deepEqual(out.json.get('network-observer'), observer.snapshot());
  });
});
