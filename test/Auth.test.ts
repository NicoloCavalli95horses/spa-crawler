import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { chromium, type Browser } from 'playwright';
import { applyAuth, authHeaders, isSameSite } from '../src/browser/Auth';

let server: Server;
let browser: Browser;
let base: string;

// the same page responds differently depending on token or cookie
before(async () => {
  server = createServer((req, res) => {
    const who = req.headers.authorization === 'Bearer tok-A' || /sid=A/.test(req.headers.cookie ?? '')
      ? 'utente A' : 'anonimo';
    res.setHeader('content-type', 'text/html');
    res.end(`<body>${who}</body>`);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/dashboard`;
  browser = await chromium.launch();
});
after(async () => { await browser.close(); server.close(); });

async function body(auth?: Parameters<typeof applyAuth>[1]): Promise<string> {
  const context = await browser.newContext();
  if (auth) await applyAuth(context, auth, base);
  const page = await context.newPage();
  await page.goto(base);
  const text = await page.innerText('body');
  await context.close();
  return text;
}

describe('Auth', () => {
  it('without credentials responds as anonymous', async () => assert.equal(await body(), 'anonimo'));
  it('bearer token', async () => assert.equal(await body({ bearerToken: 'tok-A' }), 'utente A'));
  it('wrong bearer token', async () => assert.equal(await body({ bearerToken: 'x' }), 'anonimo'));
  it('cookie', async () => assert.equal(await body({ cookies: { sid: 'A' } }), 'utente A'));
  it('headers take precedence over bearerToken', () => {
    assert.deepEqual(authHeaders({ bearerToken: 't', headers: { Authorization: 'Basic z', 'X-K': '1' } }),
      { Authorization: 'Basic z', 'X-K': '1' });
  });
  it('credentials only go to the explored site', () => {
    assert.ok(isSameSite('https://api.busuu.com/x', 'https://www.busuu.com/a'));
    assert.ok(isSameSite('https://www.busuu.com/x', 'https://busuu.com'));
    assert.ok(!isSameSite('https://evil.com/busuu.com', 'https://www.busuu.com'));
    assert.ok(!isSameSite('https://notbusuu.com/', 'https://www.busuu.com'));
  });
});
