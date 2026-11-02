import type { Page } from 'playwright';
import { log } from 'crawlee';
import type {
  IStabilityWaiter, IActionExecutor, IStateCapturer, IStateNavigator, IStateStore, IStateGraph, IExplorationHooks,
} from './interfaces';
import type { UIState, Action, ElementDescriptor } from './types';

export interface ExplorationLimits {
  maxDepth: number;
  maxStates: number;   // per tab: guarantees termination even on very rich UIs
  maxDurationSecs: number;  // time budget: shuts down before the Crawlee timeout
}

/** A tab that explores: it has its own page and its own count of saved states. */
interface Worker {
  page: Page;
  saved: number;
  limitLogged: boolean;
}

const IDLE_POLL_MS = 50;

export class DfsExplorer {
  private deadline = Infinity;
  /** States with elements still to try: an idle tab takes work from another one here. */
  private frontier: UIState[] = [];
  private active = 0;   // tabs currently visiting a state

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
   * Each tab runs a DFS; tabs share the store and the graph. Work splits by itself:
   * markExplored is synchronous, so whoever calls it first claims the (state, element) pair.
   * `extraPages` are extra tabs of the same context; hooks run only on `page`.
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
      // even if the exploration is interrupted, the graph collected so far is saved
      await this.graph.persist();
      log.info(`Exploration finished: ${this.store.count()} states, ${this.graph.edgeCount()} edges`);
    }
  }

  /** Visits one state after another while there is work; if there is none but other tabs are still discovering, waits. */
  private async work(w: Worker): Promise<void> {
    for (;;) {
      if (this.limitReached(w)) return;
      const state = this.claimable();
      if (state) {
        this.active++;   // no await between claimable and here: no other tab can conclude that the work is done
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

  /** The oldest state with elements still to try: short path, hence a cheap restore. */
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
        // a problematic element only costs its own branch
        log.warning(`Error on "${el.text ?? el.selector}" in state ${state.id}: ${(err as Error).message}`);
        continue;
      }
      if (next) await this.visit(w, next);
    }
  }

  /** Restores the state, clicks the element, captures the result. Returns the state if it is new. */
  private async step(w: Worker, state: UIState, el: ElementDescriptor): Promise<UIState | null> {
    const { page } = w;
    if (!(await this.navigator.restore(page, state))) {
      log.debug(`State ${state.id} cannot be restored, skipping "${el.text ?? el.selector}"`);
      return null;
    }

    // we are now on `state`: let hooks (e.g. the extension) record it before we click away from it
    await this.hooks?.beforeAction?.(page);

    const action: Action = { type: 'click', target: el };
    if (!(await this.executor.execute(page, action))) return null;

    const next = await this.capture(page, [...state.path, action], state.depth + 1);
    this.graph.addEdge(state.id, action, next.id);
    // has and save are synchronous up to the insertion: of two tabs arriving together, only the first one saves
    if (this.store.has(next.id)) return null;   // state already seen: no recursion

    await this.save(w, next);
    await this.graph.persist();   // the graph grows along with the states: readers see it up to date while the exploration is running
    log.info(`New state ${next.id} at depth ${next.depth} (${next.clickables.length} clickables)`);
    return next;
  }

  private limitReached(w: Worker): boolean {
    let reason: string | null = null;
    if (w.saved >= this.limits.maxStates) {
      reason = `limit of ${this.limits.maxStates} states`;
    } else if (Date.now() >= this.deadline) {
      reason = `budget of ${this.limits.maxDurationSecs}s`;
    }
    if (reason && !w.limitLogged) {
      log.warning(`Reached the ${reason}: exploration stopped`);
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
