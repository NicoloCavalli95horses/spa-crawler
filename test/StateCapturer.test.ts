import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Page } from 'playwright';
import { StateCapturer } from '../src/state/StateCapturer';
import type { FingerprintInput } from '../src/core/interfaces';
import { descriptor } from './helpers/fakes';

describe('StateCapturer', () => {
  it('unisce cliccabili, testi e URL e ne calcola l\'id', async () => {
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
});
