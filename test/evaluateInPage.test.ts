import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateInPage } from '../src/browser/evaluateInPage';
import { useBrowser } from './helpers/browser';

const browser = useBrowser();

function withInnerFunctions(arg: { a: number; b: number }): number {
  const add = (x: number, y: number) => x + y;   // con tsx diventa __name(...)
  return add(arg.a, arg.b);
}

describe('evaluateInPage', () => {
  it('esegue funzioni con funzioni interne e passa l\'argomento', async () => {
    const page = await browser.withHtml('<p></p>');
    assert.equal(await evaluateInPage(page, withInnerFunctions, { a: 2, b: 3 }), 5);
  });

  it('non dipende da un __name globale definito dal sito', async () => {
    const page = await browser.withHtml('<script>window.__name = () => undefined</script>');
    assert.equal(await evaluateInPage(page, withInnerFunctions, { a: 2, b: 3 }), 5);
  });

  it('attende le funzioni asincrone', async () => {
    const page = await browser.withHtml('<p></p>');
    const delayed = async () => { await new Promise((r) => setTimeout(r, 50)); return 'ok'; };
    assert.equal(await evaluateInPage(page, delayed, undefined), 'ok');
  });
});
