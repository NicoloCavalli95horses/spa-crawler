import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { AnalysisPipeline } from '../src/analysis/AnalysisPipeline';
import { HttpEventStore } from '../src/db/HttpEventStore';
import { PreindexedValueStore } from '../src/db/PreindexedValueStore';
import { ReactStateStore, type RapidorGraph } from '../src/db/ReactStateStore';
import { VulnerabilityStore } from '../src/db/VulnerabilityStore';
import { AnalysisStatsStore } from '../src/db/AnalysisStatsStore';
import { AuthzClassifier } from '../src/analysis/authzClassifier';
import { AuthzClassificationStore } from '../src/db/AuthzClassificationStore';
import { installParamUsageTracking } from '../src/browser/paramUsageTracker';
import { useBrowser, APP_ORIGIN } from './helpers/browser';

let root: string;
before(async () => { root = await mkdtemp(join(tmpdir(), 'crawler-test-')); });
after(async () => { await rm(root, { recursive: true, force: true }); });

/** Sibling nodes of the same component, differing in `id` (not authz-relevant by itself) and in the
 * sensitive-looking `premium` flag — exactly matchFinder.test.ts's own fixture shape. */
function siblingGraph(): RapidorGraph {
  return {
    fingerprint: 'f1',
    nodes: {
      'node-1': { id: 'node-1', componentId: 1, props: { id: '101', premium: false } },
      'node-2': { id: 'node-2', componentId: 1, props: { id: '102', premium: true } },
    },
    componentIndex: { '1': ['node-1', 'node-2'] },
  };
}

describe('AnalysisPipeline: client-side-only query params', () => {
  let n = 0;
  function newPipeline() {
    const db = new Database(join(root, `${n++}.db`));
    const httpEventStore = new HttpEventStore({ db, clearOnStart: true });
    const preindexStore = new PreindexedValueStore({ db, clearOnStart: true });
    const reactStateStore = new ReactStateStore({ db, clearOnStart: true });
    const vulnerabilityStore = new VulnerabilityStore({ db, clearOnStart: true });
    const statsStore = new AnalysisStatsStore({ db, clearOnStart: true });
    const classifier = new AuthzClassifier(new AuthzClassificationStore({ db, clearOnStart: true }));
    const pipeline = new AnalysisPipeline({
      httpEventStore, preindexStore, reactStateStore, vulnerabilityStore, statsStore, classifier,
      options: { maxConcurrentRequests: 1, timeBetweenRequestsMs: 0 },
    });
    return { pipeline, httpEventStore, preindexStore, reactStateStore, vulnerabilityStore, classifier };
  }

  const { newPage } = useBrowser();

  // A page that reads ?id= on every popstate and re-renders it — it never makes a network request
  // for it, mirroring a SPA that resolves the id purely from already-loaded client state. Replaces
  // the child element (not just its text) so the DOM mutation is a childList one: clientRouting.ts's
  // MutationObserver only watches childList/attributes, same limitation noted in react-app-target.
  const html = `<div id="out"></div><script>
    function render() {
      const out = document.getElementById('out');
      out.innerHTML = '';
      const p = document.createElement('p');
      p.textContent = new URLSearchParams(location.search).get('id');
      out.appendChild(p);
    }
    window.addEventListener('popstate', render);
    render();
  </script>`;

  it('flags a sibling id as a candidate and tests it via pushState, with no HTTP request involved', async () => {
    const { pipeline, preindexStore, reactStateStore, vulnerabilityStore, classifier } = newPipeline();
    // pre-seed the classifier cache: 'premium' is authz-relevant, 'id' is not — skips loading the
    // real embedding model (see authzClassifier.test.ts for the slow, real-model equivalent)
    (classifier as unknown as { cache: Map<string, unknown> }).cache.set('id', { score: 0, isAuthZRelevant: false });
    (classifier as unknown as { cache: Map<string, unknown> }).cache.set('premium', { score: 1, isAuthZRelevant: true });

    const page = await newPage();
    await installParamUsageTracking(page); // must be an init script, in place before the page's own script runs
    await page.route(`${APP_ORIGIN}/**`, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: html }));
    const pageUrl = `${APP_ORIGIN}/?id=101`;
    await page.goto(pageUrl);

    const graph = siblingGraph();
    const stateId = reactStateStore.record({ site: 'app.test', url: pageUrl, graph })!;
    preindexStore.reindex({ stateId, graph });

    await pipeline.runForSite({ page, site: 'app.test' });

    const findings = vulnerabilityStore.count('app.test');
    assert.equal(findings, 1);
  });

  it('never flags anything when the differing props are not authz-relevant', async () => {
    const { pipeline, preindexStore, reactStateStore, vulnerabilityStore, classifier } = newPipeline();
    (classifier as unknown as { cache: Map<string, unknown> }).cache.set('id', { score: 0, isAuthZRelevant: false });
    (classifier as unknown as { cache: Map<string, unknown> }).cache.set('premium', { score: 0, isAuthZRelevant: false });

    const page = await newPage();
    await installParamUsageTracking(page);
    await page.route(`${APP_ORIGIN}/**`, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: html }));
    const pageUrl = `${APP_ORIGIN}/?id=101`;
    await page.goto(pageUrl);

    const graph = siblingGraph();
    const stateId = reactStateStore.record({ site: 'app.test', url: pageUrl, graph })!;
    preindexStore.reindex({ stateId, graph });

    await pipeline.runForSite({ page, site: 'app.test' });

    assert.equal(vulnerabilityStore.count('app.test'), 0);
  });
});
