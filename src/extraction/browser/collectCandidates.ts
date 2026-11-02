// This function is serialized and executed INSIDE the browser with page.evaluate:
// it cannot import anything or use outer variables. Everything it needs lives in here.
import type { Rect } from '../../core/geometry';

export interface RawElement {
  tag: string;
  cssPath: string;
  rect: Rect;
  fixed: boolean;
  text?: string;
  role?: string;
  ariaLabel?: string;
  href?: string;
}

export interface CollectOptions { maxTextLength: number }

export function collectCandidates(opts: CollectOptions): RawElement[] {
  const SEMANTIC = [
    'a[href]', 'button', 'select', 'summary',
    'input[type=button]', 'input[type=submit]', 'input[type=reset]',
    'input[type=checkbox]', 'input[type=radio]', 'input[type=image]',
    '[role=button]', '[role=link]', '[role=tab]', '[role=menuitem]',
    '[role=menuitemcheckbox]', '[role=menuitemradio]', '[role=option]',
    '[role=checkbox]', '[role=radio]', '[role=switch]', '[role=treeitem]',
    '[onclick]', '[tabindex]:not([tabindex="-1"])',
  ].join(',');

  // 1. Candidates: semantic, React handlers, or root of an area with cursor: pointer
  const candidates = new Set<Element>(document.querySelectorAll(SEMANTIC));
  for (const el of document.body.querySelectorAll('*')) {
    if (candidates.has(el)) continue;

    // React does not put onClick in the DOM: we look for it in the node's internal props
    const reactKey = Object.keys(el).find((k) => k.startsWith('__reactProps$'));
    const props = reactKey ? (el as any)[reactKey] : null;
    if (props && (props.onClick || props.onMouseDown || props.onPointerDown || props.onMouseUp)) {
      candidates.add(el);
      continue;
    }

    // cursor is inherited: we keep only the first node of the chain that sets it
    if (getComputedStyle(el).cursor === 'pointer') {
      const parent = el.parentElement;
      if (!parent || getComputedStyle(parent).cursor !== 'pointer') candidates.add(el);
    }
  }

  // 2. Filter: visible, enabled, not covered by other elements
  const isUsable = (el: Element): DOMRect | null => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return null;
    const style = getComputedStyle(el);
    if (style.pointerEvents === 'none') return null;
    if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return null;
    if (el.closest('[aria-hidden="true"],[inert]')) return null;
    if ((el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') return null;

    // hit-test only possible inside the viewport: discards what lies under a modal
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    if (cx >= 0 && cy >= 0 && cx < innerWidth && cy < innerHeight) {
      const hit = document.elementFromPoint(cx, cy);
      if (!hit || !el.contains(hit)) return null;
    }
    return r;
  };

  const usable = new Map<Element, DOMRect>();
  for (const el of candidates) {
    const r = isUsable(el);
    if (r) usable.set(el, r);
  }

  // 3. Dedupe: a clickable container as large as its clickable child is the same target
  const sameRect = (a: DOMRect, b: DOMRect) =>
    Math.abs(a.x - b.x) < 2 && Math.abs(a.y - b.y) < 2 &&
    Math.abs(a.width - b.width) < 2 && Math.abs(a.height - b.height) < 2;
  for (const [el, r] of usable) {
    for (let p = el.parentElement; p; p = p.parentElement) {
      const pr = usable.get(p);
      if (pr && sameRect(pr, r)) usable.delete(p);
    }
  }

  // 4. Serialization, in document order
  const cssPathOf = (el: Element): string => {
    const parts: string[] = [];
    for (let n: Element | null = el; n && n !== document.body; n = n.parentElement) {
      const tag = n.tagName.toLowerCase();
      let index = 1;
      for (let s = n.previousElementSibling; s; s = s.previousElementSibling) {
        if (s.tagName === n.tagName) index++;
      }
      parts.unshift(`${tag}:nth-of-type(${index})`);
    }
    return ['body', ...parts].join(' > ');
  };
  const isFixed = (el: Element): boolean => {
    for (let n: Element | null = el; n; n = n.parentElement) {
      if (getComputedStyle(n).position === 'fixed') return true;
    }
    return false;
  };
  const clean = (s: string | null | undefined) =>
    s ? s.replace(/\s+/g, ' ').trim().slice(0, opts.maxTextLength) || undefined : undefined;

  const ordered = [...usable.keys()].sort((a, b) =>
    a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);

  return ordered.map((el) => {
    const r = usable.get(el)!;
    const fixed = isFixed(el);
    // document coordinates, so scrolling does not change the rectangle; fixed elements stay in viewport coordinates
    const dx = fixed ? 0 : scrollX;
    const dy = fixed ? 0 : scrollY;
    return {
      tag: el.tagName.toLowerCase(),
      cssPath: cssPathOf(el),
      rect: { x: r.x + dx, y: r.y + dy, width: r.width, height: r.height },
      fixed,
      // value counts as text only for button-like inputs (for a checkbox it would be "on")
      text: clean((el as HTMLElement).innerText ||
        (el.matches('input[type=button],input[type=submit],input[type=reset]')
          ? (el as HTMLInputElement).value : undefined)),
      role: el.getAttribute('role') ?? undefined,
      ariaLabel: clean(el.getAttribute('aria-label') ?? el.getAttribute('title')),
      href: el.getAttribute('href') ?? undefined,
    };
  });
}
