import type { Page } from 'playwright';
import type {
  IClickableExtractor, IPageTextExtractor, IStateCapturer, IStateFingerprinter,
} from '../core/interfaces';
import type { Snapshot } from '../core/types';

export class StateCapturer implements IStateCapturer {
  constructor(
    private clickables: IClickableExtractor,
    private texts: IPageTextExtractor,
    private fingerprinter: IStateFingerprinter,
  ) {}

  async capture(page: Page): Promise<Snapshot> {
    const clickables = await this.clickables.extract(page);
    const texts = await this.texts.extract(page);
    const url = page.url();
    const id = this.fingerprinter.fingerprint({ url, clickables, texts });
    return { id, url, clickables, texts };
  }
}
