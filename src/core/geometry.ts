export interface Rect { x: number; y: number; width: number; height: number }

/** Arrotonda il rettangolo su una griglia, per assorbire differenze sub-pixel tra render. */
export function snapRect(r: Rect, gridPx: number): Rect {
  const s = (v: number) => Math.round(v / gridPx) * gridPx;
  return { x: s(r.x), y: s(r.y), width: s(r.width), height: s(r.height) };
}
