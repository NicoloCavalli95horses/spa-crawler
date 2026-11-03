import { log } from 'crawlee';
import type { IExplorationHooks } from '../core/interfaces';
import type { NetworkObserver } from './NetworkObserver';

/** Logs what NetworkObserver captured; the events themselves are already in the HttpEventStore. */
export class NetworkObserverHooks implements IExplorationHooks {
  constructor(private observer: NetworkObserver) {}

  async onStart(): Promise<void> {}

  async onEnd(): Promise<void> {
    const { stats } = this.observer.snapshot();
    log.info(`NetworkObserver: captured ${stats.total} same-site fetch/XHR request(s), deduplicated into the HttpEventStore`);
  }
}
