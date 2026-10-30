// Eseguita nel browser con evaluateInPage: niente import, tutto qui dentro.

export interface PageTextOptions { maxBlocks: number; maxBlockLength: number }

/** Blocchi di testo visibili, in ordine di documento e senza duplicati. */
export function collectPageText(opts: PageTextOptions): string[] {
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TEXTAREA', 'SVG']);
  const visibility = new Map<Element, boolean>();
  const isVisible = (el: Element): boolean => {
    let v = visibility.get(el);
    if (v === undefined) {
      v = !SKIP.has(el.tagName.toUpperCase()) &&
        el.checkVisibility({ opacityProperty: true, visibilityProperty: true }) &&
        !el.closest('[aria-hidden="true"],[inert]');
      visibility.set(el, v);
    }
    return v;
  };

  const blocks: string[] = [];
  const seen = new Set<string>();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n && blocks.length < opts.maxBlocks; n = walker.nextNode()) {
    const parent = n.parentElement;
    if (!parent || !isVisible(parent)) continue;
    const text = (n.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, opts.maxBlockLength);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    blocks.push(text);
  }
  return blocks;
}
