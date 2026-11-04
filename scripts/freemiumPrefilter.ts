/**
 * Cheap triage over a Tranco range (plus any always-include domains), without logging in or running
 * the full crawler. Two stages, in this order:
 *   1. React gate: the engine only supports React apps, so a domain that does not use React is
 *      dropped before anything else is computed. Static markup markers first (Next.js, data-reactroot,
 *      ...); when those show nothing, a Playwright pass checks whether react-dom registers itself.
 *   2. Freemium score, for React sites only: visible UI phrases whose sentence embedding is close to
 *      paywall concepts (same model as the authz classifier, see freemiumClassifier.ts), plus
 *      billing-provider scripts (js.stripe.com, ...). A client-rendered SPA shell often has neither in
 *      its raw markup, so a rendered pass also kicks in when the static score is zero.
 * Domains that already have a row in freemium_candidates are skipped (unless --recheck), so a wider
 * range only costs the new ones.
 * Narrows which domains are worth a manual login and a full exploration — it is not an IDOR finding.
 *
 *   npm run freemium-prefilter -- --top 500
 *   npm run freemium-prefilter -- --top 500 --include memrise.com,busuu.com,babbel.com
 *   npm run freemium-prefilter -- --top 0 --include memrise.com --render all   # curated list only
 *   npm run freemium-prefilter -- --top 500 --recheck       # also re-check domains already in the db
 *   npm run freemium-prefilter -- --top 500 --render none   # static only: React is only detected via markup markers
 */
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import { log } from 'crawlee';
import { runWithConcurrency } from '../src/analysis/requestForge';
import { scoreFreemiumSignals, htmlToText, type FreemiumScore } from '../src/analysis/freemiumHeuristics';
import { FreemiumPhraseClassifier } from '../src/analysis/freemiumClassifier';
import { detectReactInHtml, installReactProbe, readReactEvidence } from '../src/analysis/reactDetection';
import { FreemiumCandidateStore } from '../src/db/FreemiumCandidateStore';
import { openDatabase } from '../src/db/openDatabase';
import { config } from '../src/config';

const TRANCO = 'https://tranco-list.eu';

const { values: args } = parseArgs({
  options: {
    top: { type: 'string', default: '200' },
    start: { type: 'string', default: '1' },
    'list-id': { type: 'string' },
    include: { type: 'string' },                  // comma-separated domains always checked, Tranco rank or not
    render: { type: 'string', default: 'zero-score' },   // none | zero-score | all (a render is always needed to confirm React when the markup does not show it)
    concurrency: { type: 'string', default: '10' },
    'render-concurrency': { type: 'string', default: '3' },
    'timeout-ms': { type: 'string', default: '8000' },
    'min-score': { type: 'string', default: '1' },       // only affects what gets printed, not what gets stored
    'show-non-react': { type: 'boolean', default: false },  // also print domains that failed the React gate
    recheck: { type: 'boolean', default: false },   // check domains even if they are already in the db
    db: { type: 'string', default: config.db.path },
  },
});

function intArg({ name, value, min = 0 }: { name: string; value: string | undefined; min?: number }): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min) throw new Error(`--${name} must be an integer >= ${min}, not "${value}"`);
  return n;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} responded ${res.status}`);
  return res.text();
}

interface TrancoEntry { rank: number; domain: string }

/** Same download as scripts/tranco.ts: ranks `start`..`start+count-1` of the given (or latest) list. */
async function fetchTranco(
  { start, count, listId }: { start: number; count: number; listId?: string },
): Promise<TrancoEntry[]> {
  if (count <= 0) return [];
  const id = listId ?? (await fetchText(`${TRANCO}/top-1m-id`)).trim();
  const csv = await fetchText(`${TRANCO}/download/${id}/${start + count - 1}`);
  return csv.split('\n')
    .map((line) => line.trim().split(','))
    .map(([rank, domain]) => ({ rank: Number(rank), domain }))
    .filter((e): e is TrancoEntry => Boolean(e.domain) && e.rank >= start)
    .slice(0, count);
}

async function fetchStatic({ domain, timeoutMs }: { domain: string; timeoutMs: number }): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`https://${domain}/`, { signal: controller.signal, redirect: 'follow' });
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

interface RenderedPage { html: string; text: string; reactEvidence: string[] }

/** Playwright pass for SPA shells the static fetch couldn't see through: render, then re-read the DOM. */
async function fetchRendered(
  { domain, timeoutMs, browser }: { domain: string; timeoutMs: number; browser: import('playwright').Browser },
): Promise<RenderedPage> {
  const page = await browser.newPage();
  try {
    await installReactProbe({ page });
    await page.goto(`https://${domain}/`, { timeout: timeoutMs, waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: timeoutMs }).catch(() => {});
    const html = await page.content();
    const text = await page.evaluate(() => document.body.innerText).catch(() => '');
    const reactEvidence = await readReactEvidence({ page }).catch(() => []);
    return { html, text, reactEvidence };
  } finally {
    await page.close().catch(() => {});
  }
}

const top = intArg({ name: 'top', value: args.top });
const start = intArg({ name: 'start', value: args.start, min: 1 });
const concurrency = intArg({ name: 'concurrency', value: args.concurrency, min: 1 });
const renderConcurrency = intArg({ name: 'render-concurrency', value: args['render-concurrency'], min: 1 });
const timeoutMs = intArg({ name: 'timeout-ms', value: args['timeout-ms'], min: 1 });
const minScore = intArg({ name: 'min-score', value: args['min-score'] });
const renderMode = args.render as 'none' | 'zero-score' | 'all';
if (!['none', 'zero-score', 'all'].includes(renderMode)) {
  throw new Error(`--render must be one of none|zero-score|all, not "${renderMode}"`);
}

const trancoEntries = await fetchTranco({ start, count: top, listId: args['list-id'] });
const includeDomains = (args.include ?? '').split(',').map((d) => d.trim()).filter(Boolean);
const rankByDomain = new Map(trancoEntries.map((e) => [e.domain, e.rank]));
const domains = [...new Set([...trancoEntries.map((e) => e.domain), ...includeDomains])];

const db = openDatabase({ path: args.db! });
const store = new FreemiumCandidateStore({ db, clearOnStart: false });

// `domains` stays the full requested set (it is what the final table reports); `pending` is what is actually fetched
const alreadyChecked = args.recheck ? new Set<string>() : store.checkedDomains();
const pending = domains.filter((d) => !alreadyChecked.has(d));

log.info(`Checking ${pending.length} domain(s) (${trancoEntries.length} from Tranco, ${includeDomains.length} always-include, ${domains.length - pending.length} already in the db skipped), render=${renderMode}`);
const classifier = new FreemiumPhraseClassifier();

const browser = renderMode === 'none' ? null : await chromium.launch({ headless: true });
let rendering = 0;
let completed = 0;

async function renderThrottled(domain: string): Promise<RenderedPage | null> {
  try {
    rendering++;
    return await fetchRendered({ domain, timeoutMs, browser: browser! });
  } catch {
    return null;   // a navigation failure here is not worth surfacing as an error
  } finally {
    rendering--;
  }
}

async function checkDomain(domain: string, index: number): Promise<void> {
  const progress = `[${index + 1}/${pending.length}]`;
  const rank = rankByDomain.get(domain) ?? null;
  log.info(`${progress} Checking ${domain}...`);

  let html: string;
  try {
    html = await fetchStatic({ domain, timeoutMs });
  } catch (err) {
    completed++;
    const message = err instanceof Error ? err.message : String(err);
    log.info(`${progress} ${domain}: failed (${message}) [${completed}/${pending.length} done]`);
    store.record({
      domain, rank, isReact: false, reactEvidence: [], score: 0,
      keywordHits: [], billingScriptHits: [], renderedWithJs: false,
      error: message,
    });
    return;
  }

  // stage 1: React gate. Static markers can only confirm, so without them a render has to decide.
  let reactEvidence = detectReactInHtml({ html });
  let rendered: RenderedPage | null = null;
  let renderedWithJs = false;
  if (reactEvidence.length === 0 && browser) {
    rendered = await renderThrottled(domain);
    renderedWithJs = rendered !== null;
    reactEvidence = rendered?.reactEvidence ?? [];
  }
  if (reactEvidence.length === 0) {
    completed++;
    store.record({ domain, rank, isReact: false, reactEvidence: [], score: 0, keywordHits: [], billingScriptHits: [], renderedWithJs, error: null });
    log.info(`${progress} ${domain}: not React, skipped [${completed}/${pending.length} done]`);
    return;
  }

  // stage 2: freemium score, on whatever we already rendered, else on the static markup
  const scoreOf = (page: { html: string; text: string }): Promise<FreemiumScore> =>
    scoreFreemiumSignals({ html: page.html, text: page.text, classifier });
  let result = await scoreOf(rendered ?? { html, text: htmlToText(html) });

  const shouldRender = browser && !rendered && (renderMode === 'all' || (renderMode === 'zero-score' && result.score === 0));
  if (shouldRender) {
    rendered = await renderThrottled(domain);
    if (rendered) {
      renderedWithJs = true;
      const rescored = await scoreOf(rendered);
      if (rescored.score > result.score) result = rescored;
    }
  }

  store.record({ domain, rank, isReact: true, reactEvidence, ...result, renderedWithJs, error: null });
  completed++;
  log.info(`${progress} ${domain}: React (${reactEvidence.join(', ')}), score ${result.score}${renderedWithJs ? ' (rendered)' : ''} [${completed}/${pending.length} done]`);
}

// the static fetches run at full concurrency; the Playwright fallback is throttled separately by
// capping how many `checkDomain` calls are inside their render step at once (crude but sufficient
// for a triage script: a browser page is much heavier than a bare fetch)
await runWithConcurrency({
  tasks: pending.map((domain, index) => async () => {
    while (rendering >= renderConcurrency) await new Promise((r) => setTimeout(r, 100));
    await checkDomain(domain, index);
  }),
  limit: concurrency,
});

await browser?.close();

const results = store.all().filter((r) => domains.includes(r.domain));
const reactCount = results.filter((r) => r.isReact).length;
const shown = results.filter((r) =>
  includeDomains.includes(r.domain) || (r.isReact ? r.score >= minScore : args['show-non-react']));
console.log(`\n${results.length} domains (${pending.length} newly checked), ${reactCount} use React, ${shown.length} shown (React with score >= ${minScore}, or always-include):\n`);
console.table(shown.map((r) => ({
  domain: r.domain, rank: r.rank ?? '-', react: r.isReact ? r.reactEvidence.join(', ') : 'no', score: r.score,
  keywords: r.keywordHits.join(' | ') || '-',
  billing: r.billingScriptHits.join(', ') || '-',
  rendered: r.renderedWithJs ? 'yes' : 'no',
  error: r.error ?? '-',
})));
