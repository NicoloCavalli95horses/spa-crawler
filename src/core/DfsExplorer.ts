import type { Page } from 'playwright';
import { log } from 'crawlee';
import type {
  IStabilityWaiter, IActionExecutor, IStateCapturer, IStateNavigator, IStateStore, IStateGraph, IExplorationHooks,
} from './interfaces';
import type { UIState, Action, ElementDescriptor } from './types';

export interface ExplorationLimits {
  maxDepth: number;
  maxStates: number;   // per tab: garantisce la terminazione anche su UI molto ricche
  maxDurationSecs: number;  // budget di tempo: chiude prima del timeout di Crawlee
}

/** Una tab che esplora: ha la sua pagina e il suo conteggio di stati salvati. */
interface Worker {
  page: Page;
  saved: number;
  limitLogged: boolean;
}

const IDLE_POLL_MS = 50;

export class DfsExplorer {
  private deadline = Infinity;
  /** Stati con ancora elementi da provare: da qui una tab libera prende lavoro da un'altra. */
  private frontier: UIState[] = [];
  private active = 0;   // tab che stanno visitando uno stato

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

  /**
   * Ogni tab fa una DFS; le tab condividono store e grafo. Il lavoro si divide da solo:
   * markExplored è sincrono, quindi chi lo chiama per primo si prende la coppia (stato, elemento).
   * `extraPages` sono tab aggiuntive dello stesso contesto; gli hook girano solo su `page`.
   */
  async explore(page: Page, extraPages: Page[] = []): Promise<void> {
    this.deadline = Date.now() + this.limits.maxDurationSecs * 1000;
    try {
      await this.hooks?.onStart(page);
      const workers: Worker[] = [page, ...extraPages].map((p) => ({ page: p, saved: 0, limitLogged: false }));
      const root = await this.capture(page, [], 0);
      await this.save(workers[0], root);
      const results = await Promise.allSettled(workers.map((w) => this.work(w)));
      const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
      if (failed) throw failed.reason;
    } finally {
      await this.hooks?.onEnd(page);
      // anche se l'esplorazione si interrompe, il grafo raccolto fin qui viene salvato
      await this.graph.persist();
      log.info(`Esplorazione terminata: ${this.store.count()} stati, ${this.graph.edgeCount()} archi`);
    }
  }

  /** Visita uno stato dopo l'altro finché c'è lavoro; se non ce n'è ma altre tab stanno ancora scoprendo, aspetta. */
  private async work(w: Worker): Promise<void> {
    for (;;) {
      if (this.limitReached(w)) return;
      const state = this.claimable();
      if (state) {
        this.active++;   // senza await tra claimable e qui: nessun'altra tab può concludere che il lavoro è finito
        try {
          await this.visit(w, state);
        } finally {
          this.active--;
        }
      } else if (this.active === 0) {
        return;
      } else {
        await new Promise((resolve) => setTimeout(resolve, IDLE_POLL_MS));
      }
    }
  }

  /** Il più vecchio stato con elementi ancora da provare: percorso corto, quindi ripristino economico. */
  private claimable(): UIState | null {
    while (this.frontier.length > 0) {
      const s = this.frontier[0];
      if (s.clickables.some((el) => !this.store.isExplored(s.id, el.id))) return s;
      this.frontier.shift();
    }
    return null;
  }

  private async save(w: Worker, state: UIState): Promise<void> {
    w.saved++;
    if (state.depth < this.limits.maxDepth && state.clickables.length > 0) this.frontier.push(state);
    await this.store.save(w.page, state);
  }

  private async visit(w: Worker, state: UIState): Promise<void> {
    if (state.depth >= this.limits.maxDepth) return;

    for (const el of state.clickables) {
      if (this.limitReached(w)) return;
      if (this.store.isExplored(state.id, el.id)) continue;
      this.store.markExplored(state.id, el.id);

      let next: UIState | null = null;
      try {
        next = await this.step(w, state, el);
      } catch (err) {
        // un elemento problematico costa solo il suo ramo
        log.warning(`Errore su "${el.text ?? el.selector}" nello stato ${state.id}: ${(err as Error).message}`);
        continue;
      }
      if (next) await this.visit(w, next);
    }
  }

  /** Ripristina lo stato, clicca l'elemento, cattura il risultato. Restituisce lo stato se è nuovo. */
  private async step(w: Worker, state: UIState, el: ElementDescriptor): Promise<UIState | null> {
    const { page } = w;
    if (!(await this.navigator.restore(page, state))) {
      log.debug(`Stato ${state.id} non ripristinabile, salto "${el.text ?? el.selector}"`);
      return null;
    }

    const action: Action = { type: 'click', target: el };
    if (!(await this.executor.execute(page, action))) return null;

    const next = await this.capture(page, [...state.path, action], state.depth + 1);
    this.graph.addEdge(state.id, action, next.id);
    // has e save sono sincroni fino all'inserimento: di due tab arrivate insieme, solo la prima salva
    if (this.store.has(next.id)) return null;   // stato già visto: niente ricorsione

    await this.save(w, next);
    await this.graph.persist();   // il grafo cresce insieme agli stati: chi legge a esplorazione in corso lo vede aggiornato
    log.info(`Nuovo stato ${next.id} a profondità ${next.depth} (${next.clickables.length} cliccabili)`);
    return next;
  }

  private limitReached(w: Worker): boolean {
    let reason: string | null = null;
    if (w.saved >= this.limits.maxStates) {
      reason = `limite di ${this.limits.maxStates} stati`;
    } else if (Date.now() >= this.deadline) {
      reason = `budget di ${this.limits.maxDurationSecs}s`;
    }
    if (reason && !w.limitLogged) {
      log.warning(`Raggiunto il ${reason}: esplorazione interrotta`);
      w.limitLogged = true;
    }
    return reason !== null;
  }

  private async capture(page: Page, path: Action[], depth: number): Promise<UIState> {
    await this.waiter.waitForStable(page);
    const snapshot = await this.capturer.capture(page);
    return { ...snapshot, depth, path };
  }
}
