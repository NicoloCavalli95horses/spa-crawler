import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StabilityWaiter } from '../src/browser/StabilityWaiter';
import { APP_ORIGIN, useBrowser } from './helpers/browser';
import './helpers/fakes';

const browser = useBrowser();
const timed = async (fn: () => Promise<void>) => { const t = Date.now(); await fn(); return Date.now() - t; };

describe('StabilityWaiter', () => {
  it('on a still page waits only for the quiet window', async () => {
    const page = await browser.withHtml('<p>ferma</p>');
    const ms = await timed(() => new StabilityWaiter({ quietMs: 300, timeoutMs: 5000 }).waitForStable(page));
    assert.ok(ms >= 300 && ms < 1500, `${ms}ms`);
  });

  it('waits for DOM mutations to end', async () => {
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

  it('waits for a render that starts shortly after the call (e.g. after a click)', async () => {
    const page = await browser.withHtml('<div id="c"></div>');
    await page.evaluate(() => setTimeout(() => {
      document.getElementById('c')!.textContent = 'arrivato';
    }, 200));
    await new StabilityWaiter({ quietMs: 400, timeoutMs: 5000 }).waitForStable(page);
    assert.equal(await page.textContent('#c'), 'arrivato');
  });

  it('waits for query-param / URL changes to settle (history.pushState without a DOM mutation)', async () => {
    const page = await browser.open({ '/': '<p>app</p>' });
    // change the query param a few times via pushState, without touching the DOM; the last change
    // lands ~300ms in, so the waiter must not return before the URL has been quiet for quietMs
    await page.evaluate(() => {
      let n = 0;
      const t = setInterval(() => {
        n++;
        history.pushState({}, '', `/?step=${n}`);
        if (n === 3) clearInterval(t);
      }, 100);
    });
    const start = Date.now();
    await new StabilityWaiter({ quietMs: 300, timeoutMs: 5000 }).waitForStable(page);
    const ms = Date.now() - start;
    // last pushState at ~300ms, then 300ms of URL quiet => at least ~550ms
    assert.ok(ms >= 550, `${ms}ms`);
    assert.match(page.url(), /step=3/);
  });

  it('waits for in-flight network requests', async () => {
    const page = await browser.open({ '/': '<p>app</p>' });
    await page.route(`${APP_ORIGIN}/api`, async (route) => {
      await new Promise((r) => setTimeout(r, 800));
      await route.fulfill({ body: 'ok' });
    });
    const waiter = new StabilityWaiter({ quietMs: 200, timeoutMs: 5000 });
    await waiter.waitForStable(page);   // attaches the network tracker
    await page.evaluate(() => { void fetch('/api'); });
    const ms = await timed(() => waiter.waitForStable(page));
    assert.ok(ms >= 800, `${ms}ms`);
  });

  it('ignores requests that have been open too long (long-poll)', async () => {
    const page = await browser.open({ '/': '<p>app</p>' });
    await page.route(`${APP_ORIGIN}/poll`, () => { /* never responds */ });
    const waiter = new StabilityWaiter({ quietMs: 200, timeoutMs: 5000, longRequestMs: 500 });
    await waiter.waitForStable(page);
    await page.evaluate(() => { void fetch('/poll'); });
    const ms = await timed(() => waiter.waitForStable(page));
    assert.ok(ms < 2500, `${ms}ms`);
  });

  it('waits for finite animations and ignores infinite ones', async () => {
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

  it('does not exceed the timeout on a page that never settles', async () => {
    const page = await browser.withHtml('<div id="c"></div>');
    await page.evaluate(() => setInterval(() => {
      document.getElementById('c')!.textContent = String(Date.now());
    }, 50));
    const ms = await timed(() => new StabilityWaiter({ quietMs: 300, timeoutMs: 1000 }).waitForStable(page));
    assert.ok(ms >= 1000 && ms < 2000, `${ms}ms`);
  });
});
