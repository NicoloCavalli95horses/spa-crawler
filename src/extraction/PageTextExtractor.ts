import type { Page } from 'playwright';
import type { IPageTextExtractor } from '../core/interfaces';
import { evaluateInPage } from '../browser/evaluateInPage';
import { collectPageText, type PageTextOptions } from './browser/collectPageText';

export class PageTextExtractor implements IPageTextExtractor {
  constructor(private opts: PageTextOptions = { maxBlocks: 2000, maxBlockLength: 200 }) {}

  extract(page: Page): Promise<string[]> {
    return evaluateInPage(page, collectPageText, this.opts);
  }
}
