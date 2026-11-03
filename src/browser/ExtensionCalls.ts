import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Page } from 'playwright';
import { log } from 'crawlee';
import type { IExplorationHooks } from '../core/interfaces';
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
 * Calls the `window.*` functions exposed by the extension at the start and end of the exploration.
 * An extension error never interrupts the exploration; results are only logged, not persisted — the
 * crawler's own SQLite stores (NetworkObserver/ReactStateHooks/AnalysisPipeline) are the source of
 * truth for anything worth keeping, and a getData-style result from RAPIDOR's own `mode: 'minimal'`
 * carries nothing but runtime-error logs to surface anyway.
 */
interface HandshakeStats { total: number; ready: number; notReady: number; unavailable: number }

export class ExtensionCalls implements IExplorationHooks {
  // how often each handshake found the page ready vs not (logged at the end)
  private stats: Record<'before-action' | 'after-action', HandshakeStats> = {
    'before-action': { total: 0, ready: 0, notReady: 0, unavailable: 0 },
    'after-action': { total: 0, ready: 0, notReady: 0, unavailable: 0 },
  };

  constructor(
    private extension: ExtensionConfig,
    private timeoutMs: number,
  ) {}

  onStart(page: Page): Promise<void> { return this.run(page, 'start'); }

  async onEnd(page: Page): Promise<void> {
    await this.run(page, 'end');
    this.logHandshakeStats('before-action', 'wait-to-action');
    this.logHandshakeStats('after-action', 'wait-for-analysis');
  }

  beforeAction(page: Page): Promise<void> { return this.handshake(page, 'before-action'); }
  afterAction(page: Page): Promise<void> { return this.handshake(page, 'after-action'); }

  private logHandshakeStats(when: 'before-action' | 'after-action', label: string): void {
    const s = this.stats[when];
    if (s.total === 0) return;
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
        log.info(`Extension: window.${call.fn}() called (${when})`);
        this.reportRuntimeErrors(value);
      } catch (err) {
        log.warning(`Extension: window.${call.fn}() (${when}) failed: ${(err as Error).message}`);
      }
    }
  }

  /**
   * Surfaces extension runtime errors to the crawler log. A getData-style result carries per-tab
   * `logs` with `{ type, msg }` entries; RAPIDOR records uncaught errors/rejections there, so the
   * crawler can tell when the extension broke mid-run. Defensive: unknown shapes are ignored.
   */
  private reportRuntimeErrors(value: unknown): void {
    const entries = Array.isArray(value) ? value : [value];
    const errors: string[] = [];
    for (const entry of entries) {
      const logs = (entry as { logs?: unknown } | null)?.logs;
      if (!Array.isArray(logs)) continue;
      for (const l of logs) {
        if ((l as { type?: string } | null)?.type === 'error') errors.push(String((l as { msg?: unknown }).msg));
      }
    }
    if (errors.length > 0) {
      log.warning(`Extension reported ${errors.length} runtime error(s); first: ${errors[0]}`);
    }
  }
}
