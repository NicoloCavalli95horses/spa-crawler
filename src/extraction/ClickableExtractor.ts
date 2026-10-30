import type { Page } from 'playwright';
import type { IClickableExtractor } from '../core/interfaces';
import type { ElementDescriptor } from '../core/types';
import type { SelectorBuilder } from './SelectorBuilder';
import { collectCandidates, type RawElement } from './browser/collectCandidates';
import { evaluateInPage } from '../browser/evaluateInPage';

export class ClickableExtractor implements IClickableExtractor {
  private blocklist: string[];

  constructor(
    private selectorBuilder: SelectorBuilder,
    blocklist: string[],
    private maxTextLength = 80,
  ) {
    this.blocklist = blocklist.map((b) => b.toLowerCase());
  }

  async extract(page: Page): Promise<ElementDescriptor[]> {
    const raws = await evaluateInPage(page, collectCandidates, { maxTextLength: this.maxTextLength });

    const result: ElementDescriptor[] = [];
    const seen = new Map<string, number>();
    for (const raw of raws) {
      if (this.isBlocked(raw)) continue;
      const desc = this.selectorBuilder.build(raw);

      // due elementi con stesso tag e stesso rettangolo: li distinguiamo con l'ordine
      const n = seen.get(desc.id) ?? 0;
      seen.set(desc.id, n + 1);
      if (n > 0) desc.id = `${desc.id}:${n}`;

      result.push(desc);
    }
    return result;
  }

  private isBlocked(raw: RawElement): boolean {
    const haystack = [raw.text, raw.ariaLabel, raw.href]
      .filter(Boolean).join(' ').toLowerCase();
    return this.blocklist.some((b) => haystack.includes(b));
  }
}
