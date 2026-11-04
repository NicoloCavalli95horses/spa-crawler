/**
 * React detection for scripts/freemiumPrefilter.ts: the crawler's engine (RAPIDOR) only supports
 * React apps, so this is the first filter applied to every candidate domain.
 *
 * Two tiers: a cheap static pass over the raw markup (positive evidence only: a client-rendered SPA
 * shell proves nothing either way), and a rendered pass that asks the browser. The rendered pass
 * mirrors how RAPIDOR itself attaches: React announces itself to `__REACT_DEVTOOLS_GLOBAL_HOOK__`
 * through `inject()` as soon as react-dom loads, in production builds too.
 */
import type { Page } from 'playwright';

// Markers that only appear in markup produced by React or by a React framework (Next.js, Gatsby,
// Remix). Deliberately conservative: no bare `id="root"`, which is just as common in Vue/Svelte apps.
const STATIC_MARKERS: readonly { evidence: string; pattern: RegExp }[] = [
  { evidence: 'data-reactroot', pattern: /\sdata-reactroot\b/i },
  { evidence: 'next.js', pattern: /__NEXT_DATA__|\/_next\/static\/|\sid=["']__next["']/ },
  { evidence: 'gatsby', pattern: /\sid=["']___gatsby["']/ },
  { evidence: 'remix', pattern: /window\.__remixContext|__reactRouterContext/ },
  { evidence: 'react-script', pattern: /<script[^>]+src=["'][^"']*\/react(?:-dom)?(?:\.(?:production|development|min)|@\d|\/umd)[^"']*["']/i },
];

/** Positive-only: an empty result means "unknown", not "not React". */
export function detectReactInHtml({ html }: { html: string }): string[] {
  return STATIC_MARKERS.filter((m) => m.pattern.test(html)).map((m) => m.evidence);
}

// Installed before any page script runs. Only records what gets injected; if a hook is already
// there (it never is in a plain Chromium) it is left alone. Kept as a string on purpose: a function
// passed to addInitScript would be serialized after the TS toolchain has rewritten it.
const HOOK_INIT_SCRIPT = `
  if (!window.__REACT_DEVTOOLS_GLOBAL_HOOK__) {
    var renderers = new Map();
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      renderers: renderers, supportsFiber: true, isDisabled: false,
      inject: function (renderer) { renderers.set(renderers.size + 1, renderer); return renderers.size; },
      checkDCE: function () {}, onCommitFiberRoot: function () {}, onCommitFiberUnmount: function () {},
      onScheduleFiberRoot: function () {}, onPostCommitFiberRoot: function () {},
    };
  }
`;

/** Call before `page.goto`. */
export async function installReactProbe({ page }: { page: Page }): Promise<void> {
  await page.addInitScript(HOOK_INIT_SCRIPT);
}

/** Call after the page has settled: what the probe and the DOM say about React. */
export async function readReactEvidence({ page }: { page: Page }): Promise<string[]> {
  return page.evaluate(`(() => {
    const evidence = [];
    const hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
    if (hook && hook.renderers && hook.renderers.size > 0) evidence.push('devtools-hook');
    // fallback for a bundle that connected before the probe or ignores the hook: React 16+ tags its root container
    const roots = [document.body, ...document.body.children, ...document.querySelectorAll('#root, #app, #__next')];
    if (roots.some((el) => Object.keys(el).some((k) => k.startsWith('__reactContainer$') || k.startsWith('_reactRootContainer')))) {
      evidence.push('root-container');
    }
    return evidence;
  })()`) as Promise<string[]>;
}
