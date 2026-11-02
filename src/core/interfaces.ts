import type { Page } from 'playwright';
import type { Action, ElementDescriptor, Snapshot, StateRecord, UIState } from './types.js';

export interface IClickableExtractor { extract(page: Page): Promise<ElementDescriptor[]> }
export interface IPageTextExtractor { extract(page: Page): Promise<string[]> }
export interface IStabilityWaiter { waitForStable(page: Page): Promise<void> }
export interface IActionExecutor { execute(page: Page, a: Action): Promise<boolean> }

export interface FingerprintInput { url: string; clickables: ElementDescriptor[]; texts: string[] }
/** Pure function: same data, same hash. No browser access. */
export interface IStateFingerprinter { fingerprint(input: FingerprintInput): string }

/** Extracts clickables and texts and computes the id: the only way the engine "looks" at the page. */
export interface IStateCapturer { capture(page: Page): Promise<Snapshot> }

export interface IStateNavigator { restore(page: Page, s: UIState): Promise<boolean> }

export interface IStateStore {
  has(id: string): boolean;
  count(): number;
  save(page: Page, s: UIState): Promise<void>;
  isExplored(stateId: string, elId: string): boolean;
  markExplored(stateId: string, elId: string): void;
}
export interface IStateGraph {
  addEdge(from: string, a: Action, to: string): void;
  edgeCount(): number;
  persist(): Promise<void>;
}

/** Where results end up. In production Crawlee, in tests an in-memory sink. */
export interface IOutputSink {
  saveState(record: StateRecord): Promise<void>;
  /** Returns the actual key under which the file was saved. */
  saveFile(key: string, data: Buffer, contentType: string): Promise<string>;
  saveJson(key: string, value: unknown): Promise<void>;
}

/** Points where external code (e.g. a browser extension) observes the exploration. */
export interface IExplorationHooks {
  /** Before the initial state is captured. */
  onStart(page: Page): Promise<void>;
  /** After the last state, even if the exploration was interrupted by an error. */
  onEnd(page: Page): Promise<void>;
  /** Before each action on `page` (every tab). Must never throw. Used to let the extension record
   * the current page's state before the crawler navigates away. */
  beforeAction?(page: Page): Promise<void>;
  /** After each action, on the resulting `page`. Must never throw. Used to let the extension finish
   * analysing the result before the crawler reloads to the next element. */
  afterAction?(page: Page): Promise<void>;
}
