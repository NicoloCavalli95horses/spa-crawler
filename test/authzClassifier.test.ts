import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AuthzClassifier, assessAuthZ } from '../src/analysis/authzClassifier';
import { compareObj } from '../src/analysis/responseEvaluate';

// Loads a real embedding model (cached under node_modules/@huggingface/transformers/.cache after
// the first run); slower than the rest of the suite, same tradeoff RAPIDOR's own offscreen
// classifier already accepted.
describe('AuthzClassifier', { timeout: 120_000 }, () => {
  it('classifies an authorization-relevant key above the threshold', async () => {
    const classifier = new AuthzClassifier();
    const result = await classifier.classify('premium');
    assert.equal(result.isAuthZRelevant, true);
  });

  it('does not classify a neutral key as authorization-relevant', async () => {
    const classifier = new AuthzClassifier();
    const result = await classifier.classify('title');
    assert.equal(result.isAuthZRelevant, false);
  });

  it('caches repeated classifications (same score object identity-equal content on reuse)', async () => {
    const classifier = new AuthzClassifier();
    const first = await classifier.classify('role');
    const second = await classifier.classify('role');
    assert.deepEqual(first, second);
  });

  it('assessAuthZ flags a premium/free prop diff as authz-relevant; a cosmetic diff is not', async () => {
    const classifier = new AuthzClassifier();

    const premiumDiff = compareObj({ id: 'a', premium: false }, { id: 'b', premium: true });
    const premiumAssessment = await assessAuthZ({ differences: premiumDiff, classifier });
    assert.equal(premiumAssessment.isAuthzRelevant, true);
    assert.ok(premiumAssessment.sensitiveKeys.includes('premium'));

    const cosmeticDiff = compareObj({ title: 'apple' }, { title: 'banana' });
    const cosmeticAssessment = await assessAuthZ({ differences: cosmeticDiff, classifier });
    assert.equal(cosmeticAssessment.isAuthzRelevant, false);
  });
});
