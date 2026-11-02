import type { FingerprintInput, IStateFingerprinter } from '../core/interfaces';
import { shortHash } from '../core/hash';
import { normalizeText } from '../core/text';

export interface FingerprintOptions {
  /** Includes the URL pathname and hash: two routes with the same layout remain distinct states. */
  includeUrl: boolean;
  /** Includes the normalized visible texts: same layout with different contents = different states. */
  includePageText: boolean;
}

/**
 * The state is the sorted set of the clickables' ids, optionally with URL and texts.
 * The sets are sorted, so DOM order does not matter.
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
