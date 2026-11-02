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
interface HandshakeStats { total: number; ready: number; notReady: number; unavailable: number }

export class ExtensionCalls implements IExplorationHooks {
  // how often each handshake found the page ready vs not (saved with the results at the end)
  private stats: Record<'before-action' | 'after-action', HandshakeStats> = {
    'before-action': { total: 0, ready: 0, notReady: 0, unavailable: 0 },
    'after-action': { total: 0, ready: 0, notReady: 0, unavailable: 0 },
  };

  constructor(
    private extension: ExtensionConfig,
    private output: IOutputSink,
    private timeoutMs: number,
  ) {}

  onStart(page: Page): Promise<void> { return this.run(page, 'start'); }

  async onEnd(page: Page): Promise<void> {
    await this.run(page, 'end');
    await this.saveHandshakeStats('before-action', 'wait-to-action');
    await this.saveHandshakeStats('after-action', 'wait-for-analysis');
  }

  beforeAction(page: Page): Promise<void> { return this.handshake(page, 'before-action'); }
  afterAction(page: Page): Promise<void> { return this.handshake(page, 'after-action'); }

  private async saveHandshakeStats(when: 'before-action' | 'after-action', label: string): Promise<void> {
    const s = this.stats[when];
    if (s.total === 0) return;
    await this.output.saveJson(`${when}-stats`, s);
    log.info(`${label}: ${s.ready}/${s.total} ready, ${s.notReady} not ready, ${s.unavailable} unavailable`);
  }

  /**
   * Runs the handshake calls for `when` on `page` and interprets each boolean result (false = not
   * ready / not idle). Never throws and never blocks: a missing function, a timeout or an error just
   * counts as "unavailable" and the crawler proceeds. Shared by every tab.
   */
  private async handshake(page: Page, when: 'before-action' | 'after-action'): Promise<void> {
    const calls = this.extension.calls.filter((c) => c.when === when);
    const stats = this.stats[when];
    // the function is injected at document_start, so it is almost always already there
    const probeMs = Math.min(this.timeoutMs, 1_000);
    for (const call of calls) {
      stats.total++;
      try {
        await page.waitForFunction(
          (name) => typeof (window as unknown as Record<string, unknown>)[name] === 'function',
          call.fn, { timeout: probeMs },
        );
        const ready = await evaluateInPage(
          page,
          ({ fn, args }) => (window as unknown as Record<string, (...a: unknown[]) => unknown>)[fn](...args),
          { fn: call.fn, args: call.args ?? [] },
        );
        if (ready === false) stats.notReady++;
        else stats.ready++;
      } catch {
        // page without the extension injected, closed, or navigating: not worth blocking on
        stats.unavailable++;
      }
    }
  }

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
