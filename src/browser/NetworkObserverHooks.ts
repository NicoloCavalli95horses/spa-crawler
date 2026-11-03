import type { Page } from 'playwright';
import { log } from 'crawlee';
import type { IExplorationHooks, IOutputSink } from '../core/interfaces';
import type { NetworkObserver } from './NetworkObserver';

/**
 * Saves the NetworkObserver's snapshot next to the extension's own results, so the two can be
 * compared by hand (shadow mode: this never changes what the crawler does or clicks).
 */
export class NetworkObserverHooks implements IExplorationHooks {
  constructor(
    private observer: NetworkObserver,
    private output: IOutputSink,
  ) {}

  async onStart(): Promise<void> {}

  async onEnd(): Promise<void> {
    const snapshot = this.observer.snapshot();
    await this.output.saveJson('network-observer', snapshot);
    log.info(`NetworkObserver: captured ${snapshot.stats.total} same-site fetch/XHR request(s)`);
  }
}
