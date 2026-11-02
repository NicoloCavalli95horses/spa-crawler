export interface Rect { x: number; y: number; width: number; height: number }

/** Snaps the rectangle to a grid, to absorb sub-pixel differences between renders. */
export function snapRect(r: Rect, gridPx: number): Rect {
  const s = (v: number) => Math.round(v / gridPx) * gridPx;
  return { x: s(r.x), y: s(r.y), width: s(r.width), height: s(r.height) };
}
