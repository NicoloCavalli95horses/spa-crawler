// Runs in the browser via evaluateInPage: no imports, everything lives in here.
import type { Rect } from '../../core/geometry';

export interface LocateArgs {
  selector: string;
  tag: string;
  rect: Rect;
  fixed: boolean;
  tolerancePx: number;
}

/**
 * Finds the target element again and returns the point (viewport) where to click it.
 * 1. structural selector, accepted only if the rectangle matches;
 * 2. otherwise geometry: the rectangle is scrolled into the viewport and we check what is at its center.
 * Returns null if the element is gone or covered by something else.
 */
export function locateTarget(a: LocateArgs): { x: number; y: number } | null {
  const isFixed = (el: Element): boolean => {
    for (let n: Element | null = el; n; n = n.parentElement) {
      if (getComputedStyle(n).position === 'fixed') return true;
    }
    return false;
  };
  const matches = (el: Element): boolean => {
    const r = el.getBoundingClientRect();
    const fixed = isFixed(el);
    const x = r.x + (fixed ? 0 : scrollX);
    const y = r.y + (fixed ? 0 : scrollY);
    const t = a.tolerancePx;
    return fixed === a.fixed &&
      Math.abs(x - a.rect.x) <= t && Math.abs(y - a.rect.y) <= t &&
      Math.abs(r.width - a.rect.width) <= t && Math.abs(r.height - a.rect.height) <= t;
  };

  let target: Element | null = null;
  try {
    const el = document.querySelector(a.selector);
    if (el && matches(el)) target = el;
  } catch { /* invalid selector: fall back to geometry */ }

  if (!target) {
    const cx = a.rect.x + a.rect.width / 2;
    const cy = a.rect.y + a.rect.height / 2;
    if (!a.fixed) {
      scrollTo({ left: Math.max(0, cx - innerWidth / 2), top: Math.max(0, cy - innerHeight / 2), behavior: 'instant' });
    }
    const hit = document.elementFromPoint(cx - (a.fixed ? 0 : scrollX), cy - (a.fixed ? 0 : scrollY));
    const candidate = hit?.closest(a.tag);
    if (candidate && matches(candidate)) target = candidate;
  }
  if (!target) return null;

  target.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
  const r = target.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  const hit = document.elementFromPoint(x, y);
  if (!hit || !target.contains(hit)) return null;
  return { x, y };
}
