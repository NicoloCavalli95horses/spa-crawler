import type { Page } from 'playwright';

/**
 * page.evaluate wrapper for functions written in TypeScript.
 *
 * tsx/esbuild compile with keepNames and insert calls to __name(...) into functions,
 * a helper that does not exist in the browser. We define it as a local constant around the
 * function: this way we do not depend on a global __name from the site, which may do something else.
 * The argument must be JSON-serializable.
 */
export async function evaluateInPage<Arg, R>(
  page: Page,
  fn: (arg: Arg) => R | Promise<R>,
  arg: Arg,
): Promise<R> {
  const source =
    `(() => { const __name = (f) => f; return (${fn.toString()})(${JSON.stringify(arg ?? null)}); })()`;
  return page.evaluate(source) as Promise<R>;
}
