import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateInPage } from '../src/browser/evaluateInPage';
import { useBrowser } from './helpers/browser';

const browser = useBrowser();

function withInnerFunctions(arg: { a: number; b: number }): number {
  const add = (x: number, y: number) => x + y;   // with tsx this becomes __name(...)
  return add(arg.a, arg.b);
}

describe('evaluateInPage', () => {
  it('runs functions with inner functions and passes the argument', async () => {
    const page = await browser.withHtml('<p></p>');
    assert.equal(await evaluateInPage(page, withInnerFunctions, { a: 2, b: 3 }), 5);
  });

  it('does not depend on a global __name defined by the site', async () => {
    const page = await browser.withHtml('<script>window.__name = () => undefined</script>');
    assert.equal(await evaluateInPage(page, withInnerFunctions, { a: 2, b: 3 }), 5);
  });

  it('awaits async functions', async () => {
    const page = await browser.withHtml('<p></p>');
    const delayed = async () => { await new Promise((r) => setTimeout(r, 50)); return 'ok'; };
    assert.equal(await evaluateInPage(page, delayed, undefined), 'ok');
  });
});
