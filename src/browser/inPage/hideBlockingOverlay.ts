// Runs in the browser via evaluateInPage: no imports, everything lives in here.
import type { Rect } from '../../core/geometry';

export interface HideBlockingOverlayArgs {
  rect: Rect;     // the target's own saved rect (document coords) — same shape locateTarget takes
  fixed: boolean;
}

export interface HideBlockingOverlayResult {
  hidden: boolean;
  tag?: string;   // for logging: which element got display:none'd
}

/**
 * Last-resort fallback when a target is unreachable and OverlayDismisser found nothing it recognizes
 * (no role=dialog/aria-modal/<dialog open> — e.g. a plain styled div with no ARIA semantics and no
 * JS listening for Escape, which Escape therefore cannot close). Rather than diffing the DOM against
 * an earlier snapshot to guess what's new and "looks like" a blocker — a much fuzzier heuristic that
 * risks hiding something legitimate (a real popup the exploration is trying to reach is ALSO new and
 * ALSO covers things behind it, by design) — this reuses the exact hit-test locateTarget itself just
 * failed with: whatever document.elementFromPoint finds at the target's own saved coordinates IS the
 * thing in the way, by construction, no guessing needed.
 *
 * Walks up from that hit element to the first ancestor that is position:fixed/absolute AND covers at
 * least half the viewport — a plain small element (a tooltip, a badge) is left alone; only something
 * overlay-shaped gets touched. display:none, never removed from the DOM: reversible, and does not
 * desync whatever JS/React state is tracking it (a later StateNavigator.restore() reloads the page
 * anyway, so nothing here needs to persist).
 *
 * Can never end up hiding the real target by mistake: if the hit element's own rect were already
 * within tolerance of `a.rect`, locateTarget's own `matches()` check would have accepted it and this
 * function would never have been called in the first place.
 */
export function hideBlockingOverlay(a: HideBlockingOverlayArgs): HideBlockingOverlayResult {
  const cx = a.rect.x + a.rect.width / 2;
  const cy = a.rect.y + a.rect.height / 2;
  const vx = cx - (a.fixed ? 0 : scrollX);
  const vy = cy - (a.fixed ? 0 : scrollY);

  const hit = document.elementFromPoint(vx, vy);
  if (!hit) return { hidden: false };

  const viewportArea = innerWidth * innerHeight;
  for (let el: Element | null = hit; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
    const style = getComputedStyle(el);
    if (style.position !== 'fixed' && style.position !== 'absolute') continue;
    const r = el.getBoundingClientRect();
    if (viewportArea > 0 && (r.width * r.height) / viewportArea >= 0.5) {
      (el as HTMLElement).style.setProperty('display', 'none', 'important');
      return { hidden: true, tag: el.tagName.toLowerCase() };
    }
  }
  return { hidden: false };
}
