import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { log } from 'crawlee';
import type { PropDiff } from './responseEvaluate';

/**
 * Generates a standalone, runnable `.ts` reproduction script for one flagged finding. The script is
 * self-contained: it embeds the original request/response and the React props of both nodes, so it
 * never depends on storage/crawler.db (which a later crawl wipes by default).
 *
 * Running it with `npx tsx` prints, side by side:
 *  - http findings: ORIGINAL request + response (recorded), MUTATED request + response (live);
 *  - client-routing findings: opens a real browser on the original URL, takes a screenshot, applies
 *    the mutation (pushState + popstate), takes a second screenshot and writes both PNGs plus a
 *    pixel diff next to the script;
 *  - in both cases the React props of the original node and of the node whose value was spliced in.
 */

export type ReproductionKind =
  | {
      type: 'http'; method: string; headers: Record<string, string>; postData?: string;
      baselineStatus: number; baselineHeaders: Record<string, string>; baselineBody: string; baselineContentType?: string;
    }
  | { type: 'client-routing-query'; paramName: string; candidateValue: string }
  | { type: 'client-routing-path'; candidateUrl: string };

export interface ReproductionInput {
  id: string;
  site: string;
  referenceUrl: string;
  candidateUrl: string;
  motivation: string;
  differences: PropDiff[];
  sensitiveKeys: string[];
  referenceValue: string;
  candidateValue: string;
  referenceProps: unknown;
  candidateProps: unknown;
  userDataDir?: string;
  reportsDir: string;
  kind: ReproductionKind;
  clientRoutingProbe: { minWaitMs: number; idleMs: number };  // embedded verbatim so a re-run of this script tests the exact same window the original run used
}

/** JS literal, not JSON.stringify: keeps `undefined` as `undefined` rather than dropping the key silently. */
function literal(value: unknown): string {
  return value === undefined ? 'undefined' : JSON.stringify(value, null, 2);
}

/**
 * literal() above only guards a top-level undefined: JSON.stringify still silently drops any
 * undefined-valued KEY nested inside an object it's given, which is exactly what a PropDiff looks
 * like whenever a prop exists on only one side of the diff (compareObj leaves `reference` or
 * `current` undefined — see responseEvaluate.ts's own doc comment). The embedded DIFFERENCES array
 * must keep both keys present (even when `undefined`) or the generated script fails to typecheck
 * against the PropDiff type it imports — this is the actual bug behind the lint/tsc errors on
 * existing reproduction scripts. Each field goes through literal() individually instead of
 * stringifying the whole array/object in one JSON.stringify call.
 */
function literalPropDiff(d: PropDiff): string {
  return `{ "path": ${literal(d.path)}, "reference": ${literal(d.reference)}, `
    + `"current": ${literal(d.current)}, "key": ${literal(d.key)}, "pathStr": ${literal(d.pathStr)} }`;
}

function literalDiffs(differences: PropDiff[]): string {
  if (differences.length === 0) return '[]';
  return `[\n  ${differences.map(literalPropDiff).join(',\n  ')}\n]`;
}

function reproductionBody(input: ReproductionInput): string {
  const { kind } = input;
  if (kind.type === 'http') {
    return `
  const { forgeRequest } = await import('../../src/analysis/requestForge');
  const { getServerResponseSimilarity } = await import('../../src/analysis/responseEvaluate');

  const original = {
    request: { method: ${literal(kind.method)}, url: REFERENCE_URL, headers: ${literal(kind.headers)}, body: ${literal(kind.postData)} },
    response: { status: ${literal(kind.baselineStatus)}, headers: ${literal(kind.baselineHeaders)}, body: ${literal(kind.baselineBody)}, contentType: ${literal(kind.baselineContentType)} },
  };

  section('1. ORIGINAL request (as the page itself sent it)');
  printRequest(original.request);
  section('2. ORIGINAL response (recorded during the crawl)');
  printResponse(original.response);

  const mutatedRequest = { ...original.request, url: CANDIDATE_URL };
  section('3. MUTATED request (same request, ' + REFERENCE_VALUE + ' -> ' + CANDIDATE_VALUE + ')');
  printRequest(mutatedRequest);

  const forged = await forgeRequest({
    page, url: CANDIDATE_URL, method: original.request.method,
    headers: original.request.headers, postData: original.request.body,
  });
  section('4. MUTATED response (live, just now)');
  printResponse(forged);

  const similarity = getServerResponseSimilarity(original.response, forged);
  verdict = similarity.areSimilar
    ? 'similarity ' + JSON.stringify(similarity) + ' => the server answered the mutated request like a normal successful one — consistent with an IDOR.'
    : 'similarity ' + JSON.stringify(similarity) + ' => the mutated response differs from the original in shape — re-check manually (server may have changed).';

  // Screenshots: the browser opens the original and the mutated URL, as a user pasting them in the address bar would see them.
  if (original.request.method.toUpperCase() === 'GET') {
    await page.goto(REFERENCE_URL, { waitUntil: 'load' });
    originalShot = await page.screenshot();
    await page.goto(CANDIDATE_URL, { waitUntil: 'load' });
    mutatedShot = await page.screenshot();
  } else {
    console.log('(screenshots skipped: ' + original.request.method + ' requests cannot be replayed by opening a URL)');
  }
`;
  }

  const isQuery = kind.type === 'client-routing-query';
  const paramName = isQuery ? kind.paramName : '';
  const probeSetup = isQuery ? `await installParamUsageTracking(page); // init script: must run before the first navigation` : '';
  const probeImport = isQuery ? `const { installParamUsageTracking } = await import('../../src/browser/paramUsageTracker');` : '';
  const { minWaitMs, idleMs } = input.clientRoutingProbe;
  const probe = isQuery
    ? `checkClientSideRouting({ page, paramName: ${literal(paramName)}, paramValue: CANDIDATE_VALUE, minWaitMs: ${minWaitMs}, idleMs: ${idleMs} })`
    : `checkClientSideRoutingForPath({ page, targetUrl: CANDIDATE_URL, minWaitMs: ${minWaitMs}, idleMs: ${idleMs} })`;

  return `
  const { checkClientSideRouting, checkClientSideRoutingForPath } = await import('../../src/analysis/clientRouting');
  ${probeImport}
  ${probeSetup}
  await page.goto(REFERENCE_URL, { waitUntil: 'load' });
  await page.waitForTimeout(2000); // let the SPA render

  section('1. ORIGINAL page');
  console.log('URL:', REFERENCE_URL);
  originalShot = await page.screenshot();

  section('2. MUTATED page (' + REFERENCE_VALUE + ' -> ' + CANDIDATE_VALUE + ', pushState + popstate, no reload)');
  console.log('URL:', CANDIDATE_URL);
  const result = await ${probe};
  console.log('probe result:', JSON.stringify(result));
  await page.evaluate((url) => {
    window.history.pushState({}, '', url);
    window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
  }, CANDIDATE_URL);
  await page.waitForTimeout(2000);
  mutatedShot = await page.screenshot();

  verdict = result.isUsingNewParams
    ? "the page's own routing reacted to the swapped value (" + JSON.stringify(result) + ") — consistent with an IDOR."
    : 'did not reproduce this time (' + JSON.stringify(result) + ') — SPA state may have changed, re-check manually.';
`;
}

/** Runtime helpers shared by every generated script. */
const HELPERS = `
function section(title: string): void {
  console.log('\\n=== ' + title + ' ===');
}

function printRequest(req: { method: string; url: string; headers: Record<string, string>; body?: string }): void {
  console.log(req.method + ' ' + req.url);
  console.log('headers:', JSON.stringify(req.headers, null, 2));
  if (req.body) console.log('body:', req.body);
}

function printResponse(res: { status: number; headers: Record<string, string>; body: string }): void {
  console.log('status:', res.status);
  console.log('content-type:', res.headers['content-type'] ?? '(none)');
  const body = res.body.length > BODY_PREVIEW_CHARS ? res.body.slice(0, BODY_PREVIEW_CHARS) + '… (' + res.body.length + ' chars total)' : res.body;
  console.log('body:', body);
}

async function saveScreenshotsAndDiff(originalShot: Buffer | undefined, mutatedShot: Buffer | undefined): Promise<void> {
  section('Screenshots');
  if (!originalShot || !mutatedShot) { console.log('(not available)'); return; }
  const originalPath = join(OUT_DIR, BASE_NAME + '.original.png');
  const mutatedPath = join(OUT_DIR, BASE_NAME + '.mutated.png');
  writeFileSync(originalPath, originalShot);
  writeFileSync(mutatedPath, mutatedShot);
  console.log('original:', originalPath);
  console.log('mutated: ', mutatedPath);

  section('Image diff (original vs mutated)');
  const { PNG } = await import('pngjs');
  const pixelmatch = (await import('pixelmatch')).default;
  const a = PNG.sync.read(originalShot);
  const b = PNG.sync.read(mutatedShot);
  if (a.width !== b.width || a.height !== b.height) {
    console.log('(different image sizes: ' + a.width + 'x' + a.height + ' vs ' + b.width + 'x' + b.height + ' — no pixel diff computed)');
    return;
  }
  const diffPath = join(OUT_DIR, BASE_NAME + '.diff.png');
  const diff = new PNG({ width: a.width, height: a.height });
  const totalPixels = a.width * a.height;
  const changed = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.1 });
  writeFileSync(diffPath, PNG.sync.write(diff));
  const changedPct = (changed / totalPixels) * 100;
  console.log('diff image:     ', diffPath);
  console.log('changed pixels: ' + changed + ' / ' + totalPixels + ' (' + changedPct.toFixed(2) + '%)');
  console.log(changed > 0
    ? '=> the rendered page visibly changed after swapping in the candidate value.'
    : '=> no visible pixel change — the page may not have re-rendered (open the PNGs to confirm).');
}

function printProps(): void {
  section('React props');
  console.log('ORIGINAL node props (value ' + REFERENCE_VALUE + '):');
  console.log(JSON.stringify(REFERENCE_PROPS, null, 2));
  console.log('\\nPROPS of the node whose value was spliced into the mutated request (value ' + CANDIDATE_VALUE + '):');
  console.log(JSON.stringify(CANDIDATE_PROPS, null, 2));
  console.log('\\nAuthorization-relevant differences (reference -> candidate):');
  for (const d of DIFFERENCES) console.log('  ' + d.pathStr + ': ' + JSON.stringify(d.reference) + ' -> ' + JSON.stringify(d.current));
  if (SENSITIVE_KEYS.length > 0) console.log('Flagged as access-control-relevant by the sentence-embedding classifier: ' + SENSITIVE_KEYS.join(', '));
}
`;

/** Short, filesystem-safe slug for the finding's detection path, used in the generated file's name. */
function vulnTypeSlug(kind: ReproductionKind): string {
  if (kind.type === 'http') return 'http';
  if (kind.type === 'client-routing-query') return 'client-query';
  return 'client-path';
}

/**
 * yyyymmdd-hhmmss-mmm in local time, filesystem-safe (no colons/dots). Milliseconds are kept (not
 * just whole seconds) because several candidates of the same type on the same site are evaluated
 * concurrently (see AnalysisPipeline's maxConcurrentRequests), so two findings can otherwise land in
 * the same second and silently overwrite each other's file.
 */
function timestampSlug(date: Date): string {
  const pad = (n: number, width = 2): string => String(n).padStart(width, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}-${pad(date.getMilliseconds(), 3)}`;
}

/** Filesystem-safe slug of the site (dots are fine in filenames, but keep it defensive). */
function siteSlug(site: string): string {
  return site.replace(/[^a-zA-Z0-9.-]/g, '_');
}

/** Writes the reproduction script to disk and returns its path, or undefined if writing failed (never throws: a report failing to generate must not break the crawl). */
export function writeReproductionScript(input: ReproductionInput): string | undefined {
  try {
    const dir = join(input.reportsDir, input.site);
    mkdirSync(dir, { recursive: true });
    // Human-readable name: <site>_<vuln-type>_<timestamp>.
    const baseName = `${siteSlug(input.site)}_${vulnTypeSlug(input.kind)}_${timestampSlug(new Date())}`;
    const filePath = join(dir, `${baseName}.repro.ts`);

    const content = `// AUTO-GENERATED reproduction script for one flagged finding.
// Self-contained: original request/response and React props are embedded, no database needed.
//
// Finding id:         ${input.id}
// Site:               ${input.site}
// Reference (yours):  ${input.referenceUrl}
// Candidate (theirs): ${input.candidateUrl}
// Motivation:         ${input.motivation.replace(/\n/g, ' ')}
//
// Run with: npx tsx ${filePath}   (from the project root, so the relative imports resolve)
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import type { PropDiff } from '../../src/analysis/responseEvaluate';

const REFERENCE_URL = ${literal(input.referenceUrl)};
const CANDIDATE_URL = ${literal(input.candidateUrl)};
const REFERENCE_VALUE = ${literal(input.referenceValue)};
const CANDIDATE_VALUE = ${literal(input.candidateValue)};
const USER_DATA_DIR = ${literal(input.userDataDir ?? '')}; // '' = ephemeral profile
const OUT_DIR = ${literal(dir)}; // screenshots and diff land here
const BASE_NAME = ${literal(baseName)}; // screenshots/diff share this name, next to the script
const BODY_PREVIEW_CHARS = 1500;
const REFERENCE_PROPS = ${literal(input.referenceProps)};
const CANDIDATE_PROPS = ${literal(input.candidateProps)};
const DIFFERENCES: PropDiff[] = ${literalDiffs(input.differences)};
const SENSITIVE_KEYS = ${literal(input.sensitiveKeys)};
${HELPERS}
async function main() {
  const context = await chromium.launchPersistentContext(USER_DATA_DIR, { headless: false, channel: 'chromium' });
  const page = context.pages()[0] ?? await context.newPage();
  let originalShot: Buffer | undefined;
  let mutatedShot: Buffer | undefined;
  let verdict = '';

  try {
${reproductionBody(input)}
  } finally {
    await context.close();
  }

  await saveScreenshotsAndDiff(originalShot, mutatedShot);
  section('Verdict');
  console.log(verdict);
  printProps();
}

await main();
process.exit(0);
`;

    writeFileSync(filePath, content);
    return filePath;
  } catch (err) {
    log.warning(`writeReproductionScript failed (finding ${input.id} still recorded in the db): ${(err as Error).message}`);
    return undefined;
  }
}
