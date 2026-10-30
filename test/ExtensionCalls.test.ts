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

  it('chiama solo le funzioni del momento richiesto e salva il risultato', async () => {
    const out = new MemoryOutput();
    const calls = new ExtensionCalls(extension, out, 200);
    const page = await withHtml(html);

    await calls.onEnd(page);

    assert.deepEqual([...out.json], [['extension-end-getData', { ok: 'y!' }]]);
  });

  it('una funzione assente non lancia: viene solo saltata', async () => {
    const out = new MemoryOutput();
    await new ExtensionCalls(extension, out, 200).onStart(await withHtml(html));
    assert.equal(out.json.size, 0);
  });

  it('extensionLaunchArgs rifiuta cartelle senza manifest.json', () => {
    assert.throws(() => extensionLaunchArgs({ path: 'test', calls: [] }), /manifest\.json/);
    assert.equal(extensionLaunchArgs(extension).length, 2);
  });
});
