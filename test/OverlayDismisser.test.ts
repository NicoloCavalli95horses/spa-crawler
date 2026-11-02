import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { OverlayDismisser } from '../src/browser/OverlayDismisser';
import { detectOpenModal } from '../src/browser/inPage/overlays';
import { evaluateInPage } from '../src/browser/evaluateInPage';
import { useBrowser } from './helpers/browser';

const browser = useBrowser();
const dismisser = new OverlayDismisser();
const modalOpen = (page: Parameters<typeof evaluateInPage>[0]) =>
  evaluateInPage(page, detectOpenModal, undefined);

describe('OverlayDismisser', () => {
  it('closes a native modal <dialog> with Escape', async () => {
    const page = await browser.withHtml('<dialog><p>Modal body</p></dialog><button>Behind</button>');
    await page.evaluate(() => (document.querySelector('dialog') as HTMLDialogElement).showModal());
    assert.equal(await modalOpen(page), true);

    assert.equal(await dismisser.dismiss(page), true);
    assert.equal(await modalOpen(page), false);
  });

  it('clicks an explicit close control when Escape does not close the modal', async () => {
    // role=dialog that swallows Escape; closed only by its aria-label="Close" button
    const page = await browser.withHtml(`
      <div id="m" role="dialog" aria-modal="true" style="width:300px;height:200px">
        <button aria-label="Close">X</button>
        <p>Blocking content</p>
      </div>
      <script>
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape') e.stopImmediatePropagation(); }, true);
        document.querySelector('[aria-label=Close]').addEventListener('click', () => {
          document.getElementById('m').remove();
        });
      </script>`);
    assert.equal(await modalOpen(page), true);

    assert.equal(await dismisser.dismiss(page), true);
    assert.equal(await modalOpen(page), false);
  });

  it('is a no-op (returns false) when there is no modal', async () => {
    const page = await browser.withHtml('<button>Just a page</button>');
    assert.equal(await dismisser.dismiss(page), false);
  });

  it('does not touch a non-close button inside a modal', async () => {
    const page = await browser.withHtml(`
      <div role="dialog" aria-modal="true" style="width:300px;height:200px">
        <button onclick="window.__saved = true">Save</button>
      </div>
      <script>document.addEventListener('keydown', (e) => { if (e.key === 'Escape') e.stopImmediatePropagation(); }, true)</script>`);

    await dismisser.dismiss(page);

    // the modal stays open and no unrelated button was clicked
    assert.equal(await modalOpen(page), true);
    assert.equal(await page.evaluate(() => (window as unknown as { __saved?: boolean }).__saved ?? false), false);
  });
});
