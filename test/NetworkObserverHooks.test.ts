import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NetworkObserverHooks } from '../src/browser/NetworkObserverHooks';
import { NetworkObserver } from '../src/browser/NetworkObserver';

describe('NetworkObserverHooks', () => {
  it('onEnd resolves without throwing, whether or not anything was captured', async () => {
    const observer = new NetworkObserver({ origin: 'https://app.test' });
    const hooks = new NetworkObserverHooks(observer);

    await assert.doesNotReject(() => hooks.onEnd());
  });
});
