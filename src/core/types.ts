import type { Rect } from './geometry';

export interface ElementDescriptor {
  id: string;          // hash di tag + rettangolo arrotondato (+ testo normalizzato, se attivo)
  selector: string;    // percorso CSS strutturale, senza id né classi
  tag: string;
  rect: Rect;          // coordinate documento (viewport se l'elemento è fixed)
  fixed: boolean;      // true se l'elemento o un antenato ha position: fixed
  text?: string;
  role?: string;
  href?: string;
}
export interface Action { type: 'click'; target: ElementDescriptor }

/** Fotografia della pagina in un istante: ciò che serve per identificare lo stato. */
export interface Snapshot {
  id: string;
  url: string;
  clickables: ElementDescriptor[];
  texts: string[];     // blocchi di testo visibili, così come appaiono
}

export interface UIState extends Snapshot {
  depth: number;
  path: Action[];      // azioni dalla radice: serve al ripristino
}

/** Ciò che viene salvato per ogni stato. */
export interface StateRecord {
  id: string;
  url: string;
  depth: number;
  path: { type: Action['type']; targetId: string; text?: string }[];
  clickables: ElementDescriptor[];
  texts: string[];
  screenshotKey?: string;
}
