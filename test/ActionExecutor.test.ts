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
  assert.ok(el, `elemento "${text}" non trovato`);
  return el;
}
const click = (t: ElementDescriptor): Action => ({ type: 'click', target: t });
const clicks = (page: Page) => page.evaluate(() => (window as any).clicks as string[]);

const COUNTER = `
  <script>window.clicks = []</script>
  <button onclick="clicks.push('a')">A</button>
  <button onclick="clicks.push('b')">B</button>`;

describe('ActionExecutor', () => {
  it("clicca l'elemento indicato", async () => {
    const page = await browser.open({ '/': COUNTER });
    assert.equal(await executor().execute(page, click(await target(page, 'B'))), true);
    assert.deepEqual(await clicks(page), ['b']);
  });

  it('se il selettore non regge più ritrova l\'elemento dalla geometria', async () => {
    const page = await browser.open({ '/': COUNTER });
    const b = await target(page, 'B');
    assert.equal(await executor().execute(page, click({ ...b, selector: 'body > nav:nth-of-type(9)' })), true);
    assert.deepEqual(await clicks(page), ['b']);
  });

  it('non clicca se il selettore punta a un elemento in un altro punto', async () => {
    const page = await browser.open({ '/': COUNTER });
    const a = await target(page, 'A');
    const b = await target(page, 'B');
    // selettore di A ma rettangolo di B: deve vincere la geometria
    assert.equal(await executor().execute(page, click({ ...b, selector: a.selector })), true);
    assert.deepEqual(await clicks(page), ['b']);
  });

  it("restituisce false se l'elemento non c'è più", async () => {
    const page = await browser.open({ '/': COUNTER });
    const b = await target(page, 'B');
    await page.evaluate(() => document.querySelectorAll('button')[1].remove());
    assert.equal(await executor().execute(page, click(b)), false);
  });

  it("restituisce false se l'elemento è coperto", async () => {
    const page = await browser.open({ '/': COUNTER });
    const b = await target(page, 'B');
    await page.evaluate(() => document.body.insertAdjacentHTML('beforeend',
      '<div style="position:fixed;inset:0;background:#0008"></div>'));
    assert.equal(await executor().execute(page, click(b)), false);
    assert.deepEqual(await clicks(page), []);
  });

  it('raggiunge elementi fuori viewport', async () => {
    const page = await browser.open({ '/': `<script>window.clicks = []</script>
      <div style="height:3000px"></div><button onclick="clicks.push('giu')">Giu</button>` });
    assert.equal(await executor().execute(page, click(await target(page, 'Giu'))), true);
    assert.deepEqual(await clicks(page), ['giu']);
  });

  it('chiude automaticamente alert e confirm', async () => {
    const page = await browser.open({ '/': `
      <button onclick="alert('ciao'); document.title = confirm('sicuro?') ? 'si' : 'no'">Dialog</button>` });
    assert.equal(await executor().execute(page, click(await target(page, 'Dialog'))), true);
    await page.waitForFunction(() => document.title === 'no', null, { timeout: 2000 });
  });

  it('blocca la navigazione verso altri domini restando sulla pagina', async () => {
    const page = await browser.open({ '/': '<a href="https://other.test/">Esterno</a><p>casa</p>' });
    assert.equal(await executor().execute(page, click(await target(page, 'Esterno'))), true);
    await page.waitForTimeout(300);
    assert.equal(page.url(), `${APP_ORIGIN}/`);
    assert.equal(await page.textContent('p'), 'casa');
  });

  it('lascia passare la navigazione interna al dominio', async () => {
    const page = await browser.open({ '/': '<a href="/due">Vai</a>', '/due': '<p>due</p>' });
    assert.equal(await executor().execute(page, click(await target(page, 'Vai'))), true);
    await page.waitForURL(`${APP_ORIGIN}/due`);
  });

  it('chiude le nuove tab', async () => {
    const page = await browser.open({ '/': '<a href="/x" target="_blank">Tab</a>', '/x': 'x' });
    assert.equal(await executor().execute(page, click(await target(page, 'Tab'))), true);
    await page.waitForTimeout(500);
    assert.deepEqual(page.context().pages(), [page]);
  });
});
