import { Dataset, KeyValueStore } from 'crawlee';
import type { IOutputSink } from '../../core/interfaces';
import type { StateRecord } from '../../core/types';

/** Stati nel Dataset di default, file e JSON nel KeyValueStore di default. */
export class CrawleeOutput implements IOutputSink {
  async saveState(record: StateRecord): Promise<void> {
    await Dataset.pushData(record);
  }
  async saveFile(key: string, data: Buffer, contentType: string): Promise<void> {
    await KeyValueStore.setValue(key, data, { contentType });
  }
  async saveJson(key: string, value: unknown): Promise<void> {
    await KeyValueStore.setValue(key, value);
  }
}
