import type { FingerprintInput, IStateFingerprinter } from '../core/interfaces';
import { shortHash } from '../core/hash';
import { normalizeText } from '../core/text';

export interface FingerprintOptions {
  /** Include pathname e hash dell'URL: due route con lo stesso layout restano stati distinti. */
  includeUrl: boolean;
  /** Include i testi visibili normalizzati: stesso layout con contenuti diversi = stati diversi. */
  includePageText: boolean;
}

/**
 * Lo stato è l'insieme ordinato degli id dei cliccabili, eventualmente con URL e testi.
 * Gli insiemi sono ordinati, quindi l'ordine nel DOM non conta.
 */
export class StateFingerprinter implements IStateFingerprinter {
  constructor(private opts: FingerprintOptions) {}

  fingerprint(input: FingerprintInput): string {
    const parts: string[] = [];
    if (this.opts.includeUrl) {
      const u = new URL(input.url);
      parts.push(`url:${u.pathname}${u.hash}`);
    }
    parts.push(`el:${sortedUnique(input.clickables.map((c) => c.id)).join(',')}`);
    if (this.opts.includePageText) {
      parts.push(`txt:${sortedUnique(input.texts.map(normalizeText)).join('\u0001')}`);
    }
    return shortHash(parts.join('\n'));
  }
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}
