import type { Page } from 'playwright';
import { log } from 'crawlee';
import type {
  IStabilityWaiter, IActionExecutor, IStateCapturer, IStateNavigator, IStateStore, IStateGraph, IExplorationHooks,
} from './interfaces';
import type { UIState, Action, ElementDescriptor } from './types';

export interface ExplorationLimits {
  maxDepth: number;
  maxStates: number;   // garantisce la terminazione anche su UI molto ricche
  maxDurationSecs: number;  // budget di tempo: chiude prima del timeout di Crawlee
}

export class DfsExplorer {
  private limitLogged = false;
  private deadline = Infinity;

  constructor(
    private waiter: IStabilityWaiter,
    private executor: IActionExecutor,
    private capturer: IStateCapturer,
    private navigator: IStateNavigator,
    private store: IStateStore,
    private graph: IStateGraph,
    private limits: ExplorationLimits,
    private hooks?: IExplorationHooks,
  ) {}

  async explore(page: Page): Promise<void> {
    this.deadline = Date.now() + this.limits.maxDurationSecs * 1000;
    try {
      await this.hooks?.onStart(page);
      const root = await this.capture(page, [], 0);
      await this.store.save(page, root);
      await this.visit(page, root);
    } finally {
      await this.hooks?.onEnd(page);
      // anche se l'esplorazione si interrompe, il grafo raccolto fin qui viene salvato
      await this.graph.persist();
      log.info(`Esplorazione terminata: ${this.store.count()} stati, ${this.graph.edgeCount()} archi`);
    }
  }

  private async visit(page: Page, state: UIState): Promise<void> {
    if (state.depth >= this.limits.maxDepth) return;

    for (const el of state.clickables) {
      if (this.limitReached()) return;
      if (this.store.isExplored(state.id, el.id)) continue;
      this.store.markExplored(state.id, el.id);

      let next: UIState | null = null;
      try {
        next = await this.step(page, state, el);
      } catch (err) {
        // un elemento problematico costa solo il suo ramo
        log.warning(`Errore su "${el.text ?? el.selector}" nello stato ${state.id}: ${(err as Error).message}`);
        continue;
      }
      if (next) await this.visit(page, next);
    }
  }

  /** Ripristina lo stato, clicca l'elemento, cattura il risultato. Restituisce lo stato se è nuovo. */
  private async step(page: Page, state: UIState, el: ElementDescriptor): Promise<UIState | null> {
    if (!(await this.navigator.restore(page, state))) {
      log.debug(`Stato ${state.id} non ripristinabile, salto "${el.text ?? el.selector}"`);
      return null;
    }

    const action: Action = { type: 'click', target: el };
    if (!(await this.executor.execute(page, action))) return null;

    const next = await this.capture(page, [...state.path, action], state.depth + 1);
    this.graph.addEdge(state.id, action, next.id);
    if (this.store.has(next.id)) return null;   // stato già visto: niente ricorsione

    await this.store.save(page, next);
    await this.graph.persist();   // il grafo cresce insieme agli stati: chi legge a esplorazione in corso lo vede aggiornato
    log.info(`Nuovo stato ${next.id} a profondità ${next.depth} (${next.clickables.length} cliccabili)`);
    return next;
  }

  private limitReached(): boolean {
    let reason: string | null = null;
    if (this.store.count() >= this.limits.maxStates) {
      reason = `limite di ${this.limits.maxStates} stati`;
    } else if (Date.now() >= this.deadline) {
      reason = `budget di ${this.limits.maxDurationSecs}s`;
    }
    if (reason && !this.limitLogged) {
      log.warning(`Raggiunto il ${reason}: esplorazione interrotta`);
      this.limitLogged = true;
    }
    return reason !== null;
  }

  private async capture(page: Page, path: Action[], depth: number): Promise<UIState> {
    await this.waiter.waitForStable(page);
    const snapshot = await this.capturer.capture(page);
    return { ...snapshot, depth, path };
  }
}
