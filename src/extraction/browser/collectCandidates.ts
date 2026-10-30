// Questa funzione viene serializzata ed eseguita DENTRO il browser con page.evaluate:
// non può importare nulla né usare variabili esterne. Tutto ciò che le serve sta qui dentro.
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

  // 1. Candidati: semantici, handler React, oppure radice di una zona con cursor: pointer
  const candidates = new Set<Element>(document.querySelectorAll(SEMANTIC));
  for (const el of document.body.querySelectorAll('*')) {
    if (candidates.has(el)) continue;

    // React non mette onClick nel DOM: lo cerchiamo nelle props interne del nodo
    const reactKey = Object.keys(el).find((k) => k.startsWith('__reactProps$'));
    const props = reactKey ? (el as any)[reactKey] : null;
    if (props && (props.onClick || props.onMouseDown || props.onPointerDown || props.onMouseUp)) {
      candidates.add(el);
      continue;
    }

    // cursor è ereditato: teniamo solo il primo nodo della catena che lo imposta
    if (getComputedStyle(el).cursor === 'pointer') {
      const parent = el.parentElement;
      if (!parent || getComputedStyle(parent).cursor !== 'pointer') candidates.add(el);
    }
  }

  // 2. Filtro: visibile, abilitato, non coperto da altri elementi
  const isUsable = (el: Element): DOMRect | null => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return null;
    const style = getComputedStyle(el);
    if (style.pointerEvents === 'none') return null;
    if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return null;
    if (el.closest('[aria-hidden="true"],[inert]')) return null;
    if ((el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') return null;

    // hit-test possibile solo dentro la viewport: scarta ciò che sta sotto un modale
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

  // 3. Deduplica: un contenitore cliccabile grande quanto il figlio cliccabile è lo stesso bersaglio
  const sameRect = (a: DOMRect, b: DOMRect) =>
    Math.abs(a.x - b.x) < 2 && Math.abs(a.y - b.y) < 2 &&
    Math.abs(a.width - b.width) < 2 && Math.abs(a.height - b.height) < 2;
  for (const [el, r] of usable) {
    for (let p = el.parentElement; p; p = p.parentElement) {
      const pr = usable.get(p);
      if (pr && sameRect(pr, r)) usable.delete(p);
    }
  }

  // 4. Serializzazione, in ordine di documento
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
    // coordinate documento, così lo scroll non cambia il rettangolo; i fixed restano in viewport
    const dx = fixed ? 0 : scrollX;
    const dy = fixed ? 0 : scrollY;
    return {
      tag: el.tagName.toLowerCase(),
      cssPath: cssPathOf(el),
      rect: { x: r.x + dx, y: r.y + dy, width: r.width, height: r.height },
      fixed,
      // il value conta come testo solo per gli input-bottone (per una checkbox varrebbe "on")
      text: clean((el as HTMLElement).innerText ||
        (el.matches('input[type=button],input[type=submit],input[type=reset]')
          ? (el as HTMLInputElement).value : undefined)),
      role: el.getAttribute('role') ?? undefined,
      ariaLabel: clean(el.getAttribute('aria-label') ?? el.getAttribute('title')),
      href: el.getAttribute('href') ?? undefined,
    };
  });
}
