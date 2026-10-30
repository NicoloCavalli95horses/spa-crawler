import type { Page } from 'playwright';
import { log } from 'crawlee';
import type { IOutputSink, IStateStore } from '../core/interfaces';
import type { UIState } from '../core/types';

export interface StateStoreOptions { screenshots: boolean }

/** Stati visti e coppie (stato, elemento) già esplorate in memoria; i risultati vanno al sink. */
export class StateStore implements IStateStore {
  private states = new Set<string>();
  private explored = new Set<string>();

  constructor(private opts: StateStoreOptions, private output: IOutputSink) {}

  has(id: string): boolean {
    return this.states.has(id);
  }

  count(): number {
    return this.states.size;
  }

  async save(page: Page, state: UIState): Promise<void> {
    if (this.states.has(state.id)) return;
    this.states.add(state.id);   // prima di ogni await: lo stato è "visto" anche se il salvataggio fallisce

    let screenshotKey: string | undefined;
    if (this.opts.screenshots) {
      try {
        screenshotKey = await this.output.saveFile(`state-${state.id}`, await page.screenshot(), 'image/png');
      } catch (err) {
        log.warning(`Screenshot dello stato ${state.id} non riuscito: ${(err as Error).message}`);
      }
    }

    await this.output.saveState({
      id: state.id,
      url: state.url,
      depth: state.depth,
      path: state.path.map((a) => ({ type: a.type, targetId: a.target.id, text: a.target.text })),
      clickables: state.clickables,
      texts: state.texts,
      screenshotKey,
    });
  }

  isExplored(stateId: string, elId: string): boolean {
    return this.explored.has(`${stateId}|${elId}`);
  }

  markExplored(stateId: string, elId: string): void {
    this.explored.add(`${stateId}|${elId}`);
  }
}
