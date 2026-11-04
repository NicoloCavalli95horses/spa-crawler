import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { scoreFreemiumSignals, extractPhrases, htmlToText } from '../src/analysis/freemiumHeuristics';
import { FreemiumPhraseClassifier } from '../src/analysis/freemiumClassifier';

// Loads the real embedding model (cached after the first run), same tradeoff as authzClassifier.test.ts.
describe('freemiumHeuristics', { timeout: 120_000 }, () => {
  const classifier = new FreemiumPhraseClassifier();

  it('flags paywall wording that exact keyword lists would miss', async () => {
    const text = 'Welcome\nGet unlimited access\nPremium members only\nPrivacy policy\nAbout us';
    const result = await scoreFreemiumSignals({ html: '', text, classifier });
    assert.ok(result.keywordHits.includes('Get unlimited access'));
    assert.ok(result.keywordHits.includes('Premium members only'));
    assert.ok(!result.keywordHits.includes('Privacy policy'));
    assert.ok(!result.keywordHits.includes('About us'));
  });

  it('matches billing-script hosts in <script src> and weighs them', async () => {
    const html = '<html><head><script src="https://js.stripe.com/v3/"></script></head></html>';
    const result = await scoreFreemiumSignals({ html, text: '', classifier });
    assert.deepEqual(result.billingScriptHits, ['js.stripe.com']);
    assert.equal(result.score, 2);
  });

  it('finds nothing on a page with no freemium signals', async () => {
    const text = 'A simple personal blog about gardening\nHome\nOur team\nLatest news';
    const result = await scoreFreemiumSignals({ html: '<html></html>', text, classifier });
    assert.equal(result.score, 0);
    assert.deepEqual(result.keywordHits, []);
    assert.deepEqual(result.billingScriptHits, []);
  });

  it('extractPhrases keeps short unique UI labels only', () => {
    const text = ['Go Pro', 'Go Pro', '42', 'x', 'a'.repeat(80), 'one two three four five six seven eight nine'].join('\n');
    assert.deepEqual(extractPhrases({ text }), ['Go Pro']);
  });

  it('htmlToText strips scripts and styles and keeps one line per block', () => {
    const html = '<html><head><style>.a{}</style><script>var x=1;</script></head><body><h1>Hello&nbsp;world</h1><button>Go Pro</button></body></html>';
    assert.equal(htmlToText(html), 'Hello world\nGo Pro');
  });
});
