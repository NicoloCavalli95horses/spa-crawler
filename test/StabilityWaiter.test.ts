import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StabilityWaiter } from '../src/browser/StabilityWaiter';
import { APP_ORIGIN, useBrowser } from './helpers/browser';
import './helpers/fakes';

const browser = useBrowser();
const timed = async (fn: () => Promise<void>) => { const t = Date.now(); await fn(); return Date.now() - t; };

describe('StabilityWaiter', () => {
  it('su una pagina ferma attende solo la finestra di quiete', async () => {
    const page = await browser.withHtml('<p>ferma</p>');
    const ms = await timed(() => new StabilityWaiter({ quietMs: 300, timeoutMs: 5000 }).waitForStable(page));
    assert.ok(ms >= 300 && ms < 1500, `${ms}ms`);
  });

  it('attende la fine delle mutazioni del DOM', async () => {
    const page = await browser.withHtml('<div id="c"></div>');
    await page.evaluate(() => {
      let n = 0;
      const t = setInterval(() => {
        document.getElementById('c')!.append(document.createElement('p'));
        if (++n === 8) clearInterval(t);
      }, 100);
    });
    await new StabilityWaiter({ quietMs: 300, timeoutMs: 5000 }).waitForStable(page);
    assert.equal(await page.locator('#c p').count(), 8);
  });

  it('attende un render che parte poco dopo la chiamata (es. dopo un click)', async () => {
    const page = await browser.withHtml('<div id="c"></div>');
    await page.evaluate(() => setTimeout(() => {
      document.getElementById('c')!.textContent = 'arrivato';
    }, 200));
    await new StabilityWaiter({ quietMs: 400, timeoutMs: 5000 }).waitForStable(page);
    assert.equal(await page.textContent('#c'), 'arrivato');
  });

  it('attende le richieste di rete in corso', async () => {
    const page = await browser.open({ '/': '<p>app</p>' });
    await page.route(`${APP_ORIGIN}/api`, async (route) => {
      await new Promise((r) => setTimeout(r, 800));
      await route.fulfill({ body: 'ok' });
    });
    const waiter = new StabilityWaiter({ quietMs: 200, timeoutMs: 5000 });
    await waiter.waitForStable(page);   // aggancia il tracker di rete
    await page.evaluate(() => { void fetch('/api'); });
    const ms = await timed(() => waiter.waitForStable(page));
    assert.ok(ms >= 800, `${ms}ms`);
  });

  it('ignora le richieste aperte da troppo tempo (long-poll)', async () => {
    const page = await browser.open({ '/': '<p>app</p>' });
    await page.route(`${APP_ORIGIN}/poll`, () => { /* non risponde mai */ });
    const waiter = new StabilityWaiter({ quietMs: 200, timeoutMs: 5000, longRequestMs: 500 });
    await waiter.waitForStable(page);
    await page.evaluate(() => { void fetch('/poll'); });
    const ms = await timed(() => waiter.waitForStable(page));
    assert.ok(ms < 2500, `${ms}ms`);
  });

  it('attende le animazioni finite e ignora quelle infinite', async () => {
    const page = await browser.withHtml(`
      <style>
        @keyframes r { to { transform: rotate(360deg) } }
        .spin { width:10px; height:10px; animation: r 1s linear infinite }
        .once { width:10px; height:10px; animation: r 900ms linear 1 }
      </style>
      <div class="spin"></div><div class="once"></div>`);
    const ms = await timed(() => new StabilityWaiter({ quietMs: 200, timeoutMs: 5000 }).waitForStable(page));
    assert.ok(ms >= 700 && ms < 3000, `${ms}ms`);
  });

  it('non supera il timeout su una pagina che non si ferma mai', async () => {
    const page = await browser.withHtml('<div id="c"></div>');
    await page.evaluate(() => setInterval(() => {
      document.getElementById('c')!.textContent = String(Date.now());
    }, 50));
    const ms = await timed(() => new StabilityWaiter({ quietMs: 300, timeoutMs: 1000 }).waitForStable(page));
    assert.ok(ms >= 1000 && ms < 2000, `${ms}ms`);
  });
});
