import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ExtensionCalls, extensionLaunchArgs } from '../src/browser/ExtensionCalls';
import { useBrowser } from './helpers/browser';

const { withHtml } = useBrowser();

describe('ExtensionCalls', () => {
  const extension = {
    path: 'test/fixtures/extension',
    calls: [
      { fn: 'api.start', when: 'start' as const },
      { fn: 'getData', when: 'end' as const, args: ['!'] },
      { fn: 'missing', when: 'end' as const },
    ],
  };
  const html = '<script>window.calls = []; window.getData = async (s) => { window.calls.push(`getData:${s}`); return { ok: `y${s}` }; }</script>';

  it('calls only the functions for the requested moment, with their args', async () => {
    const page = await withHtml(html);
    await new ExtensionCalls(extension, 200).onEnd(page);
    assert.deepEqual(await page.evaluate(() => (window as unknown as { calls: string[] }).calls), ['getData:!']);
  });

  it('a missing function does not throw: it is just skipped', async () => {
    await new ExtensionCalls(extension, 200).onStart(await withHtml(html));   // 'api.start' isn't defined: must not throw
  });

  it('extensionLaunchArgs rejects folders without manifest.json', () => {
    assert.throws(() => extensionLaunchArgs({ path: 'test', calls: [] }), /manifest\.json/);
    assert.equal(extensionLaunchArgs(extension).length, 2);
  });

  describe('beforeAction', () => {
    const withWait = {
      path: 'test/fixtures/extension',
      calls: [{ fn: '__waitToAction', when: 'before-action' as const, args: [{ t: 1 }] }],
    };

    it('calls the handshake function on every invocation, ready or not, and never throws', async () => {
      const calls = new ExtensionCalls(withWait, 200);
      const page = await withHtml('<script>window.n = 0; window.__waitToAction = () => window.n++ === 0</script>');

      await calls.beforeAction(page);   // ready (n=0 -> true)
      await calls.beforeAction(page);   // not ready (n=1 -> false)
      await calls.onEnd(page);          // must not throw either

      assert.equal(await page.evaluate(() => (window as unknown as { n: number }).n), 2);
    });

    it('does not throw or block when the function is absent (counted as unavailable)', async () => {
      await new ExtensionCalls(withWait, 200).beforeAction(await withHtml('<p>no extension here</p>'));   // must resolve, not hang or throw
    });
  });

  describe('afterAction', () => {
    const withAnalysis = {
      path: 'test/fixtures/extension',
      calls: [{ fn: '__waitForAnalysis', when: 'after-action' as const, args: [{ timeoutMs: 1 }] }],
    };

    it('runs after-action calls on the result page', async () => {
      const calls = new ExtensionCalls(withAnalysis, 200);
      const page = await withHtml('<script>window.n = 0; window.__waitForAnalysis = () => window.n++ > 0</script>');

      await calls.afterAction(page);   // first: not idle
      await calls.afterAction(page);   // second: idle

      assert.equal(await page.evaluate(() => (window as unknown as { n: number }).n), 2);
    });

    it('does not throw when the function is absent', async () => {
      await new ExtensionCalls(withAnalysis, 200).afterAction(await withHtml('<p>nothing here</p>'));
    });
  });
});
