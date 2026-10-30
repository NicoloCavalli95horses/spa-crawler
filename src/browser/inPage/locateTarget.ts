// Eseguita nel browser con evaluateInPage: niente import, tutto qui dentro.
import type { Rect } from '../../core/geometry';

export interface LocateArgs {
  selector: string;
  tag: string;
  rect: Rect;
  fixed: boolean;
  tolerancePx: number;
}

/**
 * Ritrova l'elemento bersaglio e restituisce il punto (viewport) in cui cliccarlo.
 * 1. selettore strutturale, accettato solo se il rettangolo coincide;
 * 2. altrimenti geometria: si porta il rettangolo in viewport e si guarda cosa c'è al centro.
 * Restituisce null se l'elemento non c'è più o è coperto da altro.
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
  } catch { /* selettore non valido: si passa alla geometria */ }

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
