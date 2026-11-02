import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ExtensionCalls, extensionLaunchArgs } from '../src/browser/ExtensionCalls';
import { useBrowser } from './helpers/browser';
import { MemoryOutput } from './helpers/fakes';

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
  const html = '<script>window.getData = async (s) => ({ ok: "y" + s })</script>';

  it('calls only the functions for the requested moment and saves the result', async () => {
    const out = new MemoryOutput();
    const calls = new ExtensionCalls(extension, out, 200);
    const page = await withHtml(html);

    await calls.onEnd(page);

    assert.deepEqual([...out.json], [['extension-end-getData', { ok: 'y!' }]]);
  });

  it('a missing function does not throw: it is just skipped', async () => {
    const out = new MemoryOutput();
    await new ExtensionCalls(extension, out, 200).onStart(await withHtml(html));
    assert.equal(out.json.size, 0);
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

    it('counts ready / not-ready results and saves a summary at the end', async () => {
      const out = new MemoryOutput();
      const calls = new ExtensionCalls(withWait, out, 200);
      // returns true (ready) on the first call, false (not ready) on the second
      const page = await withHtml('<script>let n = 0; window.__waitToAction = () => n++ === 0</script>');

      await calls.beforeAction(page);
      await calls.beforeAction(page);
      await calls.onEnd(page);

      assert.deepEqual(out.json.get('before-action-stats'), { total: 2, ready: 1, notReady: 1, unavailable: 0 });
    });

    it('does not throw or block when the function is absent (counts it as unavailable)', async () => {
      const out = new MemoryOutput();
      const calls = new ExtensionCalls(withWait, out, 200);
      const page = await withHtml('<p>no extension here</p>');

      await calls.beforeAction(page);   // must resolve, not hang or throw
      await calls.onEnd(page);

      assert.deepEqual(out.json.get('before-action-stats'), { total: 1, ready: 0, notReady: 0, unavailable: 1 });
    });

    it('is a no-op when no before-action call is configured', async () => {
      const out = new MemoryOutput();
      await new ExtensionCalls(extension, out, 200).beforeAction(await withHtml(html));
      assert.equal(out.json.has('before-action-stats'), false);
    });
  });
});
