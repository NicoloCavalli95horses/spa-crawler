import { Dataset, KeyValueStore } from 'crawlee';
import type { IOutputSink } from '../../core/interfaces';
import type { StateRecord } from '../../core/types';

/**
 * Stati nel Dataset di default, file e JSON nel KeyValueStore di default.
 * Con più siti nella stessa esecuzione, `site` finisce in ogni record e fa da prefisso alle chiavi.
 */
export class CrawleeOutput implements IOutputSink {
  constructor(private site?: string) {}

  async saveState(record: StateRecord): Promise<void> {
    await Dataset.pushData(this.site ? { site: this.site, ...record } : record);
  }

  async saveFile(key: string, data: Buffer, contentType: string): Promise<string> {
    const fullKey = this.key(key);
    await KeyValueStore.setValue(fullKey, data, { contentType });
    return fullKey;
  }

  async saveJson(key: string, value: unknown): Promise<void> {
    await KeyValueStore.setValue(this.key(key), value);
  }

  /** Le chiavi ammettono solo [a-zA-Z0-9!-_.'()]: il nome host va bene così com'è. */
  private key(key: string): string {
    return this.site ? `${this.site}--${key}` : key;
  }
}
