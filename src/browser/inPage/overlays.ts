// Each function runs in the browser via evaluateInPage: it is serialized on its own, so it cannot
// use imports or module-level variables. Everything it needs is defined inside it.

/** True if at least one visible modal dialog is open. */
export function detectOpenModal(): boolean {
  const MODAL = '[role=dialog],[aria-modal="true"],dialog[open]';
  const isVisible = (el: Element): boolean => {
    const c = el as Element & { checkVisibility?: (o?: object) => boolean };
    if (c.checkVisibility && !c.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
    const r = el.getBoundingClientRect();
    return r.width >= 1 && r.height >= 1 && !el.closest('[aria-hidden="true"],[inert]');
  };
  return [...document.querySelectorAll(MODAL)].some(isVisible);
}

/**
 * Clicks an explicit close control (× / close / dismiss) inside each open modal.
 * Only accessible, in-modal controls are targeted; nothing else on the page is touched.
 * Returns true if at least one such control was clicked.
 */
export function closeOpenModal(): boolean {
  const MODAL = '[role=dialog],[aria-modal="true"],dialog[open]';
  const isVisible = (el: Element): boolean => {
    const c = el as Element & { checkVisibility?: (o?: object) => boolean };
    if (c.checkVisibility && !c.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
    const r = el.getBoundingClientRect();
    return r.width >= 1 && r.height >= 1 && !el.closest('[aria-hidden="true"],[inert]');
  };
  const CLOSE_GLYPH = /^[×✕✖╳xX]$/;                 // a bare close glyph or single "x"
  const CLOSE_WORD = /(^|[^a-z])(close|dismiss)([^a-z]|$)/i;
  const looksLikeClose = (label: string): boolean => CLOSE_GLYPH.test(label) || CLOSE_WORD.test(label);

  let clicked = false;
  for (const modal of document.querySelectorAll(MODAL)) {
    if (!isVisible(modal)) continue;
    for (const ctrl of modal.querySelectorAll('button,[role=button],[aria-label]')) {
      const label = (
        ctrl.getAttribute('aria-label') ?? (ctrl as HTMLElement).innerText ?? ctrl.getAttribute('title') ?? ''
      ).trim();
      if (label && looksLikeClose(label)) {
        (ctrl as HTMLElement).click();
        clicked = true;
        break;   // one close control per modal is enough
      }
    }
  }
  return clicked;
}
