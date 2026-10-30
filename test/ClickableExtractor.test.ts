import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ClickableExtractor } from '../src/extraction/ClickableExtractor';
import { SelectorBuilder } from '../src/extraction/SelectorBuilder';
import { useBrowser } from './helpers/browser';
import './helpers/fakes';

const browser = useBrowser();
const extractor = (blocklist: string[] = []) =>
  new ClickableExtractor(new SelectorBuilder({ gridPx: 4, includeText: true }), blocklist);
const texts = async (html: string, blocklist: string[] = []) =>
  (await extractor(blocklist).extract(await browser.withHtml(html))).map((e) => e.text);

describe('ClickableExtractor', () => {
  it('trova gli elementi semantici', async () => {
    const found = await texts(`
      <a href="/x">Link</a><button>Bottone</button><div role="button">Ruolo</div>
      <input type="checkbox" aria-label="Spunta"><div tabindex="0">Focus</div>
      <div onclick="void 0">Onclick</div><a>Senza href</a>`);
    assert.deepEqual(found, ['Link', 'Bottone', 'Ruolo', 'Spunta', 'Focus', 'Onclick']);
  });

  it('trova i div con handler React nelle props interne', async () => {
    const page = await browser.withHtml('<div id="r" style="width:100px">Card</div><div>Testo</div>');
    await page.evaluate(() => { (document.getElementById('r') as any)['__reactProps$abc'] = { onClick() {} }; });
    const found = (await extractor().extract(page)).map((e) => e.text);
    assert.deepEqual(found, ['Card']);
  });

  it('con cursor: pointer tiene solo la radice della zona cliccabile', async () => {
    const found = await texts(`
      <div style="cursor:pointer;width:200px">Riga <span>dettaglio</span></div>`);
    assert.deepEqual(found, ['Riga dettaglio']);
  });

  it('esclude elementi nascosti, disabilitati, inerti e trasparenti', async () => {
    const found = await texts(`
      <button>Visibile</button>
      <button disabled>Disabilitato</button>
      <button aria-disabled="true">Aria disabilitato</button>
      <button style="display:none">Display none</button>
      <button style="visibility:hidden">Invisibile</button>
      <div style="opacity:0"><button>Trasparente</button></div>
      <div aria-hidden="true"><button>Aria hidden</button></div>
      <div inert><button>Inerte</button></div>
      <button style="pointer-events:none">No pointer</button>`);
    assert.deepEqual(found, ['Visibile']);
  });

  it('esclude gli elementi coperti da un modale', async () => {
    const found = await texts(`
      <button>Sotto</button>
      <div style="position:fixed;inset:0;background:#0008"><button>Nel modale</button></div>`);
    assert.deepEqual(found, ['Nel modale']);
  });

  it('fonde un contenitore cliccabile con il figlio della stessa dimensione', async () => {
    const found = await texts(
      '<div style="cursor:pointer;display:inline-block"><button>Interno</button></div>');
    assert.deepEqual(found, ['Interno']);
  });

  it('applica la blocklist a testo, aria-label e href', async () => {
    const found = await texts(`
      <button>Salva</button><button>Logout</button>
      <button aria-label="Elimina account">X</button><a href="/auth/logout">Esci ora</a>`,
      ['logout', 'elimina']);
    assert.deepEqual(found, ['Salva']);
  });

  it('distingue con un suffisso elementi con stesso tag, rettangolo e testo', async () => {
    // fuori viewport non c'è hit-test: due bottoni sovrapposti restano entrambi
    const page = await browser.withHtml(`
      <div style="height:3000px"></div>
      <button style="position:absolute;left:0;top:2000px;width:50px">Uno</button>
      <button style="position:absolute;left:0;top:2000px;width:50px">Uno</button>`);
    const ids = (await extractor().extract(page)).map((e) => e.id);
    assert.equal(ids.length, 2);
    assert.equal(ids[1], `${ids[0]}:1`);
  });

  it('usa coordinate documento: lo scroll non cambia i rettangoli', async () => {
    const page = await browser.withHtml(
      '<div style="height:3000px"></div><button>In fondo</button>');
    const before = await extractor().extract(page);
    await page.evaluate(() => scrollTo(0, 2000));
    const after = await extractor().extract(page);
    assert.deepEqual(after.map((e) => e.id), before.map((e) => e.id));
    assert.deepEqual(after[0].rect, before[0].rect);
  });

  it('marca gli elementi fixed con coordinate di viewport', async () => {
    const page = await browser.withHtml(`
      <div style="height:3000px"></div>
      <footer style="position:fixed;bottom:0;left:0"><button>Footer</button></footer>`);
    await page.evaluate(() => scrollTo(0, 1500));
    const [footer] = await extractor().extract(page);
    assert.equal(footer.fixed, true);
    assert.ok(footer.rect.y < 800, `y=${footer.rect.y} dovrebbe essere dentro la viewport`);
  });

  it('produce un selettore strutturale che ritrova l\'elemento', async () => {
    const page = await browser.withHtml('<div class="x1"><p><button id="r4nd0m">Ok</button></p></div>');
    const [el] = await extractor().extract(page);
    assert.doesNotMatch(el.selector, /x1|r4nd0m/);
    assert.equal(await page.locator(el.selector).textContent(), 'Ok');
  });
});
