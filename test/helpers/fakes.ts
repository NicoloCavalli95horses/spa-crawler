import type { Page } from 'playwright';
import { log } from 'crawlee';
import type {
  IActionExecutor, IOutputSink, IStabilityWaiter, IStateCapturer,
} from '../../src/core/interfaces';
import type { Action, ElementDescriptor, Snapshot, StateRecord } from '../../src/core/types';

log.setLevel(log.LEVELS.OFF);   // niente rumore dai log del motore durante i test

export function descriptor(id: string, extra: Partial<ElementDescriptor> = {}): ElementDescriptor {
  return {
    id, selector: `#${id}`, tag: 'button', fixed: false, text: id,
    rect: { x: 0, y: 0, width: 10, height: 10 }, ...extra,
  };
}

/** Sink in memoria: permette di ispezionare cosa il motore avrebbe salvato. */
export class MemoryOutput implements IOutputSink {
  states: StateRecord[] = [];
  files = new Map<string, { data: Buffer; contentType: string }>();
  json = new Map<string, unknown>();

  async saveState(record: StateRecord) { this.states.push(record); }
  async saveFile(key: string, data: Buffer, contentType: string) { this.files.set(key, { data, contentType }); }
  async saveJson(key: string, value: unknown) { this.json.set(key, value); }
}

/**
 * Applicazione simulata: una macchina a stati.
 * transitions[stato][elemento] = stato di arrivo; 'THROW' fa lanciare un errore all'executor.
 */
export class FakeApp {
  current: string;
  gotoCount = 0;
  clicks: string[] = [];

  constructor(public transitions: Record<string, Record<string, string>>, public root = 'S0') {
    this.current = root;
  }

  /** Il minimo di Page che il motore usa sulla pagina finta. */
  page(): Page {
    return {
      url: () => `https://app.test/#${this.current}`,
      goto: async () => { this.gotoCount++; this.current = this.root; return null; },
      screenshot: async () => Buffer.from('png'),
    } as unknown as Page;
  }

  capturer(): IStateCapturer {
    return {
      capture: async (): Promise<Snapshot> => ({
        id: this.current,
        url: `https://app.test/#${this.current}`,
        clickables: Object.keys(this.transitions[this.current] ?? {}).map((id) => descriptor(id)),
        texts: [],
      }),
    };
  }

  executor(): IActionExecutor {
    return {
      execute: async (_page: Page, action: Action) => {
        const next = this.transitions[this.current]?.[action.target.id];
        if (next === 'THROW') throw new Error(`boom su ${action.target.id}`);
        if (!next) return false;
        this.clicks.push(`${this.current}.${action.target.id}`);
        this.current = next;
        return true;
      },
    };
  }
}

export const noWait: IStabilityWaiter = { waitForStable: async () => {} };
