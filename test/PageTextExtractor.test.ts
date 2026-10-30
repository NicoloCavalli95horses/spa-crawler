import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PageTextExtractor } from '../src/extraction/PageTextExtractor';
import { useBrowser } from './helpers/browser';

const browser = useBrowser();
const extract = async (html: string, opts?: ConstructorParameters<typeof PageTextExtractor>[0]) =>
  new PageTextExtractor(opts).extract(await browser.withHtml(html));

describe('PageTextExtractor', () => {
  it('restituisce i blocchi visibili in ordine, con spazi compattati', async () => {
    assert.deepEqual(await extract('<h1>Titolo</h1><p>  Primo\n   paragrafo </p><button>Ok</button>'),
      ['Titolo', 'Primo paragrafo', 'Ok']);
  });

  it('esclude testo nascosto, script, stili e aria-hidden', async () => {
    assert.deepEqual(await extract(`
      <p>Visibile</p><p style="display:none">Nascosto</p>
      <p style="visibility:hidden">Invisibile</p><div aria-hidden="true">Decorativo</div>
      <script>var x = "codice"</script><style>p{}</style>`),
      ['Visibile']);
  });

  it('elimina i duplicati', async () => {
    assert.deepEqual(await extract('<p>Ciao</p><p>Ciao</p><p>Mondo</p>'), ['Ciao', 'Mondo']);
  });

  it('rispetta i limiti di blocchi e lunghezza', async () => {
    const out = await extract('<p>uno</p><p>due</p><p>tre</p><p>abcdefghij</p>',
      { maxBlocks: 2, maxBlockLength: 5 });
    assert.deepEqual(out, ['uno', 'due']);
    const cut = await extract('<p>abcdefghij</p>', { maxBlocks: 10, maxBlockLength: 5 });
    assert.deepEqual(cut, ['abcde']);
  });
});
