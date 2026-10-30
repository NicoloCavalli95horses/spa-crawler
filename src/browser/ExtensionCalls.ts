import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Page } from 'playwright';
import { log } from 'crawlee';
import type { IExplorationHooks, IOutputSink } from '../core/interfaces';
import type { ExtensionConfig } from '../config';
import { evaluateInPage } from './evaluateInPage';

/** Argomenti di Chromium che caricano l'estensione (Chrome ignora le altre, per questo --disable-...). */
export function extensionLaunchArgs(extension: ExtensionConfig): string[] {
  const dir = resolve(extension.path);
  if (!existsSync(join(dir, 'manifest.json'))) {
    throw new Error(`extension.path "${extension.path}": manifest.json non trovato in ${dir} (i path relativi partono dalla cartella di lavoro: ${process.cwd()})`);
  }
  return [`--disable-extensions-except=${dir}`, `--load-extension=${dir}`];
}

/**
 * Chiama le funzioni `window.*` esposte dall'estensione a inizio e fine esplorazione
 * e salva il valore restituito (JSON) accanto agli altri risultati del sito.
 * Un errore sull'estensione non interrompe mai l'esplorazione.
 */
export class ExtensionCalls implements IExplorationHooks {
  constructor(
    private extension: ExtensionConfig,
    private output: IOutputSink,
    private timeoutMs: number,
  ) {}

  onStart(page: Page): Promise<void> { return this.run(page, 'start'); }
  onEnd(page: Page): Promise<void> { return this.run(page, 'end'); }

  private async run(page: Page, when: 'start' | 'end'): Promise<void> {
    for (const call of this.extension.calls.filter((c) => c.when === when)) {
      try {
        // l'estensione può iniettare le sue API dopo il caricamento della pagina
        await page.waitForFunction(
          (name) => typeof (window as unknown as Record<string, unknown>)[name] === 'function',
          call.fn, { timeout: this.timeoutMs },
        );
        const value = await evaluateInPage(
          page,
          ({ fn, args }) => (window as unknown as Record<string, (...a: unknown[]) => unknown>)[fn](...args),
          { fn: call.fn, args: call.args ?? [] },
        );
        // le chiavi del KeyValueStore ammettono solo [a-zA-Z0-9!-_.'()]
        await this.output.saveJson(`extension-${when}-${call.fn.replace(/[^\w!.'()-]/g, '_')}`, value ?? null);
        log.info(`Estensione: window.${call.fn}() chiamata (${when})`);
      } catch (err) {
        log.warning(`Estensione: window.${call.fn}() (${when}) non riuscita: ${(err as Error).message}`);
      }
    }
  }
}
