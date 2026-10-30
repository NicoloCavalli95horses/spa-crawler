import type { Page } from 'playwright';
import type { Action, ElementDescriptor, Snapshot, StateRecord, UIState } from './types.js';

export interface IClickableExtractor { extract(page: Page): Promise<ElementDescriptor[]> }
export interface IPageTextExtractor { extract(page: Page): Promise<string[]> }
export interface IStabilityWaiter { waitForStable(page: Page): Promise<void> }
export interface IActionExecutor { execute(page: Page, a: Action): Promise<boolean> }

export interface FingerprintInput { url: string; clickables: ElementDescriptor[]; texts: string[] }
/** Funzione pura: stessi dati, stesso hash. Nessun accesso al browser. */
export interface IStateFingerprinter { fingerprint(input: FingerprintInput): string }

/** Estrae cliccabili e testi e calcola l'id: l'unico modo in cui il motore "guarda" la pagina. */
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

/** Dove finiscono i risultati. In produzione Crawlee, nei test un sink in memoria. */
export interface IOutputSink {
  saveState(record: StateRecord): Promise<void>;
  /** Restituisce la chiave effettiva con cui il file è stato salvato. */
  saveFile(key: string, data: Buffer, contentType: string): Promise<string>;
  saveJson(key: string, value: unknown): Promise<void>;
}
