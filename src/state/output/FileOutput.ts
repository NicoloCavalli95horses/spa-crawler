import { mkdir, open, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { IOutputSink } from '../../core/interfaces';
import type { StateRecord } from '../../core/types';

export const SITES_DIR = 'storage/sites';
export const STATES_FILE = 'states.json';

/** `2026-10-30T12:16:20.701Z` -> `2026-10-30T12-16-20` (no ':' in file names). */
export function folderTimestamp(date: Date): string {
  return date.toISOString().slice(0, 19).replace(/:/g, '-');
}

/**
 * One folder per site, `<site>_<timestamp>`, with all the results of that analysis:
 *  - states.json: JSON array with one record per state, valid even while the exploration is running;
 *  - <key>.json: every saveJson (graph, extension results), fully rewritten atomically;
 *  - <key>: binary files (screenshots).
 */
export class FileOutput implements IOutputSink {
  readonly dir: string;
  private ready?: Promise<void>;
  private statesSize = 0;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(site: string, root = SITES_DIR, startedAt = new Date()) {
    this.dir = join(root, `${site}_${folderTimestamp(startedAt)}`);
  }

  /** A sink's writes go one at a time: states.json is a single file. */
  private serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => {});
    return run;
  }

  private ensureDir(): Promise<void> {
    this.ready ??= mkdir(this.dir, { recursive: true }).then(() => {});
    return this.ready;
  }

  saveState(record: StateRecord): Promise<void> {
    return this.serial(async () => {
      await this.ensureDir();
      const item = JSON.stringify(record, null, 1);
      const file = join(this.dir, STATES_FILE);
      if (this.statesSize === 0) {
        const head = `[\n${item}\n]`;
        await writeFile(file, head);
        this.statesSize = Buffer.byteLength(head);
        return;
      }
      // overwrites the trailing "\n]": after each state the file is valid JSON, without rewriting all of it
      const tail = `,\n${item}\n]`;
      const fh = await open(file, 'r+');
      try {
        await fh.write(tail, this.statesSize - 2);
      } finally {
        await fh.close();
      }
      this.statesSize += Buffer.byteLength(tail) - 2;
    });
  }

  saveFile(key: string, data: Buffer, _contentType: string): Promise<string> {
    return this.serial(async () => {
      await this.ensureDir();
      await writeFile(join(this.dir, key), data);
      return key;
    });
  }

  saveJson(key: string, value: unknown): Promise<void> {
    return this.serial(async () => {
      await this.ensureDir();
      const file = join(this.dir, `${key}.json`);
      // write + rename: readers (the daemon) never see a half-written file
      await writeFile(`${file}.tmp`, JSON.stringify(value, null, 1));
      await rename(`${file}.tmp`, file);
    });
  }
}
