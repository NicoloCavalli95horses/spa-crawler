import type { Page } from 'playwright';

/**
 * Takes a screenshot of the SPA rendered at `testUrl`, reached the same way the client-routing probe
 * reaches a candidate: a pushState + synthetic popstate (no real reload), then a short settle. Unlike
 * the DOM-idle probe — which does everything inside one page.evaluate and rolls back before
 * returning — this is orchestrated from Node, because the page must stay ON the candidate route long
 * enough for page.screenshot() to run; the URL is rolled back afterwards in a finally. Best-effort:
 * a real navigation destroying the context, a closed page, anything, yields undefined rather than
 * throwing, so a failed capture can never abort the analysis.
 */
export async function captureRouteScreenshot({ page, testUrl, settleMs = 1_500 }: {
  page: Page; testUrl: string; settleMs?: number;
}): Promise<Buffer | undefined> {
  const originalUrl = safeUrl(page);
  const navigate = (url: string): Promise<void> =>
    page.evaluate((u) => {
      window.history.pushState({ ignore: true }, '', u);
      window.dispatchEvent(new Event('popstate'));
    }, url);
  try {
    await navigate(testUrl);
    await page.waitForTimeout(settleMs);
    return await page.screenshot();
  } catch {
    return undefined;
  } finally {
    // put the URL back so the next probe/capture starts from the page it expects
    if (originalUrl) await navigate(originalUrl).catch(() => undefined);
  }
}

/**
 * Fraction of pixels (0..1) that differ between two screenshots, or undefined when it cannot be
 * computed (different dimensions, undecodable PNG, a missing shot). pngjs/pixelmatch are imported
 * lazily so the image libraries load only when a not-found baseline comparison actually runs.
 */
export async function screenshotDiffFraction({ a, b }: { a: Buffer; b: Buffer }): Promise<number | undefined> {
  try {
    const { PNG } = await import('pngjs');
    const pixelmatch = (await import('pixelmatch')).default;
    const imgA = PNG.sync.read(a);
    const imgB = PNG.sync.read(b);
    if (imgA.width !== imgB.width || imgA.height !== imgB.height) return undefined;
    const total = imgA.width * imgA.height;
    if (total === 0) return undefined;
    const differing = pixelmatch(imgA.data, imgB.data, null, imgA.width, imgA.height, { threshold: 0.1 });
    return differing / total;
  } catch {
    return undefined;
  }
}

/**
 * A same-shaped but (almost certainly) non-existent replacement for an id: keeps every separator and
 * the overall length/segment position, randomizing only the alphanumeric characters. Rendered in the
 * candidate's own route slot it makes the app produce its genuine "not found" page, which is exactly
 * the baseline a real candidate's render is compared against.
 */
export function makeGarbageValue(sample: string): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return sample.replace(/[A-Za-z0-9]/g, () => alphabet[Math.floor(Math.random() * alphabet.length)]);
}

/** page.url() without throwing (a closed/navigating page can still reject here on some builds). */
function safeUrl(page: Page): string {
  try {
    return page.url();
  } catch {
    return '';
  }
}
