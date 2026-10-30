import type { Page } from 'playwright';

/**
 * Wrapper of page.evaluate for functions written in TypeScript.
 * tsx/esbuild compile with keepNames and inject calls to __name(...) into functions:
 * in the browser that helper doesn't exist, so we define it as a no-op before evaluating.
 */
export async function evaluateInPage<Arg, R>(
  page: Page,
  fn: (arg: Arg) => R | Promise<R>,
  arg: Arg,
): Promise<R> {
  await page.evaluate('globalThis.__name ??= (f) => f');
  return page.evaluate(fn as any, arg) as Promise<R>;
}
