import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Page } from 'playwright';
import { StateCapturer } from '../src/state/StateCapturer';
import type { FingerprintInput } from '../src/core/interfaces';
import { descriptor } from './helpers/fakes';

describe('StateCapturer', () => {
  it('combines clickables, texts and URL and computes the id', async () => {
    const clickables = [descriptor('a')];
    const texts = ['Ciao'];
    let received: FingerprintInput | undefined;
    const capturer = new StateCapturer(
      { extract: async () => clickables },
      { extract: async () => texts },
      { fingerprint: (input) => { received = input; return 'ID'; } },
    );
    const page = { url: () => 'https://app.test/x' } as unknown as Page;

    const snap = await capturer.capture(page);

    assert.deepEqual(snap, { id: 'ID', url: 'https://app.test/x', clickables, texts });
    assert.deepEqual(received, { url: 'https://app.test/x', clickables, texts });
  });

  it('dismisses overlays before extracting, so the observed state is behind any modal', async () => {
    const order: string[] = [];
    const capturer = new StateCapturer(
      { extract: async () => { order.push('extract-clickables'); return []; } },
      { extract: async () => { order.push('extract-texts'); return []; } },
      { fingerprint: () => 'ID' },
      { dismiss: async () => { order.push('dismiss'); return true; } },
    );
    const page = { url: () => 'https://app.test/x' } as unknown as Page;

    await capturer.capture(page);

    assert.equal(order[0], 'dismiss', `dismiss must run first, got ${order}`);
    assert.deepEqual(order, ['dismiss', 'extract-clickables', 'extract-texts']);
  });
});
