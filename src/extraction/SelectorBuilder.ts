import { snapRect } from '../core/geometry';
import { shortHash } from '../core/hash';
import { normalizeText } from '../core/text';
import type { ElementDescriptor } from '../core/types';
import type { RawElement } from './browser/collectCandidates';

export interface SelectorBuilderOptions {
  gridPx: number;        // rounding step of the rectangle used in the id
  includeText: boolean;  // adds the element's normalized text to the id
}

export class SelectorBuilder {
  constructor(private opts: SelectorBuilderOptions) {}

  /** The id depends on tag, geometry and optionally text: never on DOM ids or classes. */
  build(raw: RawElement): ElementDescriptor {
    const r = snapRect(raw.rect, this.opts.gridPx);
    const text = raw.text ?? raw.ariaLabel;
    const textKey = this.opts.includeText ? normalizeText(text) : '';
    const key = `${raw.tag}|${raw.fixed ? 'F' : 'D'}|${r.x},${r.y},${r.width},${r.height}|${textKey}`;
    return {
      id: shortHash(key),
      selector: raw.cssPath,
      tag: raw.tag,
      rect: raw.rect,
      fixed: raw.fixed,
      text,
      role: raw.role,
      href: raw.href,
    };
  }
}
