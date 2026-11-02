import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Page } from 'playwright';
import { ActionExecutor } from '../src/browser/ActionExecutor';
import { ClickableExtractor } from '../src/extraction/ClickableExtractor';
import { SelectorBuilder } from '../src/extraction/SelectorBuilder';
import type { Action, ElementDescriptor } from '../src/core/types';
import { APP_ORIGIN, useBrowser } from './helpers/browser';
import './helpers/fakes';

const browser = useBrowser();
const executor = () => new ActionExecutor(APP_ORIGIN, 3000, 4);
const extractor = new ClickableExtractor(new SelectorBuilder({ gridPx: 4, includeText: true }), []);

async function target(page: Page, text: string): Promise<ElementDescriptor> {
  const el = (await extractor.extract(page)).find((e) => e.text === text);
  assert.ok(el, `element "${text}" not found`);
  return el;
}
const click = (t: ElementDescriptor): Action => ({ type: 'click', target: t });
const clicks = (page: Page) => page.evaluate(() => (window as any).clicks as string[]);

const COUNTER = `
  <script>window.clicks = []</script>
  <button onclick="clicks.push('a')">A</button>
  <button onclick="clicks.push('b')">B</button>`;

describe('ActionExecutor', () => {
  it('clicks the given element', async () => {
    const page = await browser.open({ '/': COUNTER });
    assert.equal(await executor().execute(page, click(await target(page, 'B'))), true);
    assert.deepEqual(await clicks(page), ['b']);
  });

  it('falls back to geometry when the selector no longer matches', async () => {
    const page = await browser.open({ '/': COUNTER });
    const b = await target(page, 'B');
    assert.equal(await executor().execute(page, click({ ...b, selector: 'body > nav:nth-of-type(9)' })), true);
    assert.deepEqual(await clicks(page), ['b']);
  });

  it('does not click when the selector points to an element elsewhere', async () => {
    const page = await browser.open({ '/': COUNTER });
    const a = await target(page, 'A');
    const b = await target(page, 'B');
    // A's selector but B's rectangle: geometry must win
    assert.equal(await executor().execute(page, click({ ...b, selector: a.selector })), true);
    assert.deepEqual(await clicks(page), ['b']);
  });

  it('returns false when the element is gone', async () => {
    const page = await browser.open({ '/': COUNTER });
    const b = await target(page, 'B');
    await page.evaluate(() => document.querySelectorAll('button')[1].remove());
    assert.equal(await executor().execute(page, click(b)), false);
  });

  it('returns false when the element is covered', async () => {
    const page = await browser.open({ '/': COUNTER });
    const b = await target(page, 'B');
    await page.evaluate(() => document.body.insertAdjacentHTML('beforeend',
      '<div style="position:fixed;inset:0;background:#0008"></div>'));
    assert.equal(await executor().execute(page, click(b)), false);
    assert.deepEqual(await clicks(page), []);
  });

  it('reaches elements outside the viewport', async () => {
    const page = await browser.open({ '/': `<script>window.clicks = []</script>
      <div style="height:3000px"></div><button onclick="clicks.push('giu')">Giu</button>` });
    assert.equal(await executor().execute(page, click(await target(page, 'Giu'))), true);
    assert.deepEqual(await clicks(page), ['giu']);
  });

  it('automatically dismisses alert and confirm', async () => {
    const page = await browser.open({ '/': `
      <button onclick="alert('ciao'); document.title = confirm('sicuro?') ? 'si' : 'no'">Dialog</button>` });
    assert.equal(await executor().execute(page, click(await target(page, 'Dialog'))), true);
    await page.waitForFunction(() => document.title === 'no', null, { timeout: 2000 });
  });

  it('blocks navigation to other domains, staying on the page', async () => {
    const page = await browser.open({ '/': '<a href="https://other.test/">Esterno</a><p>casa</p>' });
    assert.equal(await executor().execute(page, click(await target(page, 'Esterno'))), true);
    await page.waitForTimeout(300);
    assert.equal(page.url(), `${APP_ORIGIN}/`);
    assert.equal(await page.textContent('p'), 'casa');
  });

  it('lets same-domain navigation through', async () => {
    const page = await browser.open({ '/': '<a href="/due">Vai</a>', '/due': '<p>due</p>' });
    assert.equal(await executor().execute(page, click(await target(page, 'Vai'))), true);
    await page.waitForURL(`${APP_ORIGIN}/due`);
  });

  it('closes new tabs', async () => {
    const page = await browser.open({ '/': '<a href="/x" target="_blank">Tab</a>', '/x': 'x' });
    assert.equal(await executor().execute(page, click(await target(page, 'Tab'))), true);
    await page.waitForTimeout(500);
    assert.deepEqual(page.context().pages(), [page]);
  });
});
