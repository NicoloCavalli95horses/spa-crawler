import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { chromium, type Browser } from 'playwright';
import { applyLightweightMode, lightweightLaunchArgs, StaticAssetCache } from '../src/browser/lightweightMode';
import type { LightweightConfig } from '../src/config';

const lightweight: LightweightConfig = {
  enabled: true, blockImages: true, blockFonts: true, blockedUrlPatterns: [], cacheStaticAssets: true, assetCacheMaxMb: 10,
};
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

describe('lightweightMode', () => {
  let server: Server;
  let browser: Browser;
  let origin: string;
  const hits: Record<string, number> = {};

  before(async () => {
    server = createServer((req, res) => {
      hits[req.url!] = (hits[req.url!] ?? 0) + 1;
      if (req.url === '/app.js') { res.setHeader('content-type', 'text/javascript'); res.setHeader('cache-control', 'no-store'); res.end('window.loaded = true'); }
      else if (req.url === '/img.png') { res.setHeader('content-type', 'image/png'); res.end(PNG); }
      else { res.setHeader('content-type', 'text/html'); res.end('<style>div{transition:all 5s;box-shadow:0 0 9px red}</style><div id=a>x</div><img src="/img.png"><script src="/app.js"></script>'); }
    }).listen(0);
    origin = `http://localhost:${(server.address() as AddressInfo).port}`;
    browser = await chromium.launch({ args: lightweightLaunchArgs({ lightweight }) });
  });
  after(async () => { await browser.close(); server.close(); });

  it('shortens animations, drops shadows and does not load images', async () => {
    const page = await browser.newPage();
    await applyLightweightMode({ page, lightweight });
    await page.goto(origin);
    const style = await page.evaluate(() => {
      const css = getComputedStyle(document.getElementById('a')!);
      return { transition: css.transitionDuration, shadow: css.boxShadow };
    });
    assert.deepEqual(style, { transition: '0.001s', shadow: 'none' });
    assert.equal(hits['/img.png'], undefined);
  });

  it('serves scripts from memory on reload, even when the server says no-store', async () => {
    const page = await browser.newPage();
    const assetCache = new StaticAssetCache(10e6);
    await applyLightweightMode({ page, lightweight, assetCache });
    const before = hits['/app.js'] ?? 0;
    await page.goto(origin);
    await page.goto(origin);
    assert.equal(await page.evaluate(() => (window as unknown as { loaded: boolean }).loaded), true);
    assert.equal(hits['/app.js'], before + 1);
    assert.equal(assetCache.hits, 1);
  });
});
