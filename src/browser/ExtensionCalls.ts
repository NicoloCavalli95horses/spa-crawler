import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Page } from 'playwright';
import { log } from 'crawlee';
import type { IExplorationHooks, IOutputSink } from '../core/interfaces';
import type { ExtensionConfig } from '../config';
import { evaluateInPage } from './evaluateInPage';

/** Chromium arguments that load the extension (Chrome ignores other extensions, hence --disable-...). */
export function extensionLaunchArgs(extension: ExtensionConfig): string[] {
  const dir = resolve(extension.path);
  if (!existsSync(join(dir, 'manifest.json'))) {
    throw new Error(`extension.path "${extension.path}": manifest.json not found in ${dir} (relative paths start from the working directory: ${process.cwd()})`);
  }
  return [`--disable-extensions-except=${dir}`, `--load-extension=${dir}`];
}

/**
 * Calls the `window.*` functions exposed by the extension at the start and end of the exploration
 * and saves the returned value (JSON) next to the site's other results.
 * An extension error never interrupts the exploration.
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
        // the extension may inject its APIs after the page has loaded
        await page.waitForFunction(
          (name) => typeof (window as unknown as Record<string, unknown>)[name] === 'function',
          call.fn, { timeout: this.timeoutMs },
        );
        const value = await evaluateInPage(
          page,
          ({ fn, args }) => (window as unknown as Record<string, (...a: unknown[]) => unknown>)[fn](...args),
          { fn: call.fn, args: call.args ?? [] },
        );
        // KeyValueStore keys only allow [a-zA-Z0-9!-_.'()]
        await this.output.saveJson(`extension-${when}-${call.fn.replace(/[^\w!.'()-]/g, '_')}`, value ?? null);
        log.info(`Extension: window.${call.fn}() called (${when})`);
      } catch (err) {
        log.warning(`Extension: window.${call.fn}() (${when}) failed: ${(err as Error).message}`);
      }
    }
  }
}
