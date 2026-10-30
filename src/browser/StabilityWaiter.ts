import type { Page, Request } from 'playwright';
import { log } from 'crawlee';
import type { IStabilityWaiter } from '../core/interfaces';
import { evaluateInPage } from './evaluateInPage';

export interface StabilityOptions {
  quietMs: number;        // silenzio richiesto su DOM e rete
  timeoutMs: number;      // tetto massimo: oltre si prosegue comunque
  longRequestMs: number;  // richieste aperte da più di così (long-poll, streaming) vengono ignorate
  pollMs: number;
}

const IGNORED_TYPES = new Set(['websocket', 'eventsource', 'media', 'manifest', 'ping']);

/** Conta le richieste di rete in corso per una pagina. */
class NetworkTracker {
  private inflight = new Map<Request, number>();
  private lastActivity = Date.now();

  constructor(page: Page) {
    page.on('request', (r) => {
      if (IGNORED_TYPES.has(r.resourceType())) return;
      this.inflight.set(r, Date.now());
      this.lastActivity = Date.now();
    });
    const done = (r: Request) => {
      if (this.inflight.delete(r)) this.lastActivity = Date.now();
    };
    page.on('requestfinished', done);
    page.on('requestfailed', done);
  }

  isQuiet(quietMs: number, longRequestMs: number): boolean {
    const now = Date.now();
    for (const [req, start] of this.inflight) {
      if (now - start < longRequestMs) return false;
      if (now - start > 60_000) this.inflight.delete(req); // evita di accumulare richieste appese
    }
    return now - this.lastActivity >= quietMs;
  }
}

/** Eseguita nel browser: installa (una volta per documento) un MutationObserver e legge lo stato. */
function probeDom(): { sinceMutation: number; animations: number } {
  const w = window as any;
  if (!w.__crawlerStability) {
    const state = { last: performance.now() };
    new MutationObserver(() => { state.last = performance.now(); }).observe(document, {
      subtree: true, childList: true, attributes: true, characterData: true,
    });
    w.__crawlerStability = state;
  }
  // animazioni infinite (spinner, loader decorativi) non finirebbero mai: le ignoriamo
  const animations = document.getAnimations().filter((a) =>
    a.playState === 'running' &&
    Number.isFinite(Number(a.effect?.getComputedTiming().endTime ?? Infinity))).length;
  return { sinceMutation: performance.now() - w.__crawlerStability.last, animations };
}

export class StabilityWaiter implements IStabilityWaiter {
  private trackers = new WeakMap<Page, NetworkTracker>();
  private opts: StabilityOptions;

  constructor(opts: Partial<StabilityOptions> & Pick<StabilityOptions, 'quietMs' | 'timeoutMs'>) {
    this.opts = { longRequestMs: 3_000, pollMs: 100, ...opts };
  }

  async waitForStable(page: Page): Promise<void> {
    const { quietMs, timeoutMs, longRequestMs, pollMs } = this.opts;
    const network = this.trackerFor(page);
    const start = Date.now();
    const deadline = start + timeoutMs;

    await page.waitForLoadState('domcontentloaded', { timeout: timeoutMs }).catch(() => {});

    while (Date.now() < deadline) {
      // durante una navigazione il contesto viene distrutto: si riprova al giro dopo
      const dom = await evaluateInPage(page, probeDom, undefined).catch(() => null);
      // il silenzio va contato da quando siamo stati chiamati: dopo un click il DOM può
      // essere fermo da secondi, ma la reazione (render, fetch) non è ancora partita
      const calm = Date.now() - start >= quietMs;
      if (calm && dom && dom.sinceMutation >= quietMs && dom.animations === 0 &&
          network.isQuiet(quietMs, longRequestMs)) {
        return;
      }
      await page.waitForTimeout(pollMs);
    }
    log.debug(`StabilityWaiter: timeout di ${timeoutMs}ms su ${page.url()}, si prosegue`);
  }

  private trackerFor(page: Page): NetworkTracker {
    let t = this.trackers.get(page);
    if (!t) {
      t = new NetworkTracker(page);
      this.trackers.set(page, t);
    }
    return t;
  }
}
