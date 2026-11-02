import type { Page } from 'playwright';
import { evaluateInPage } from './evaluateInPage';
import { detectOpenModal, closeOpenModal } from './inPage/overlays';

/** What a state capturer needs from an overlay dismisser. */
export interface IOverlayDismisser {
  dismiss(page: Page): Promise<boolean>;
}

/**
 * Best-effort closing of blocking modal dialogs before a state is captured, so an interstitial does
 * not cost a level of exploration depth. Strategy A (conservative): only accessible modals
 * (role=dialog / aria-modal / <dialog open>), closed with Escape first and then an explicit in-modal
 * close control (× / close). It never clicks a backdrop and never guesses cookie-banner buttons, so
 * it will not dismiss or mutate ordinary page content. Never throws.
 */
export class OverlayDismisser implements IOverlayDismisser {
  /** Returns true if a modal was present (whether or not it could be closed). */
  async dismiss(page: Page): Promise<boolean> {
    try {
      if (!(await evaluateInPage(page, detectOpenModal, undefined))) return false;
      // 1. Escape closes <dialog> and most modal libraries
      await page.keyboard.press('Escape');
      // 2. still open? click an explicit close control inside the modal
      if (await evaluateInPage(page, detectOpenModal, undefined)) {
        await evaluateInPage(page, closeOpenModal, undefined);
      }
      return true;
    } catch {
      // page navigating or closed mid-dismiss: not worth blocking the crawl
      return false;
    }
  }
}
