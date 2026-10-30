import type { Page } from 'playwright';

/**
 * Wrapper di page.evaluate per funzioni scritte in TypeScript.
 *
 * tsx/esbuild compilano con keepNames e inseriscono nelle funzioni chiamate a __name(...),
 * un helper che nel browser non esiste. Lo definiamo come costante locale attorno alla
 * funzione: così non dipendiamo da un eventuale __name globale del sito, che può fare altro.
 * L'argomento deve essere serializzabile in JSON.
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
