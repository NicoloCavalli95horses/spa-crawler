import type { Page } from 'playwright';
import type {
  IClickableExtractor, IPageTextExtractor, IStateCapturer, IStateFingerprinter,
} from '../core/interfaces';
import type { IOverlayDismisser } from '../browser/OverlayDismisser';
import type { Snapshot } from '../core/types';

export class StateCapturer implements IStateCapturer {
  constructor(
    private clickables: IClickableExtractor,
    private texts: IPageTextExtractor,
    private fingerprinter: IStateFingerprinter,
    private dismisser?: IOverlayDismisser,   // optional: close blocking modals before observing
  ) {}

  async capture(page: Page): Promise<Snapshot> {
    // dismiss first, so the observed state is the page behind any blocking modal. Done here (the one
    // chokepoint every capture goes through) so capture and restore see the same, consistent state.
    if (this.dismisser) await this.dismisser.dismiss(page);
    const clickables = await this.clickables.extract(page);
    const texts = await this.texts.extract(page);
    const url = page.url();
    const id = this.fingerprinter.fingerprint({ url, clickables, texts });
    return { id, url, clickables, texts };
  }
}
