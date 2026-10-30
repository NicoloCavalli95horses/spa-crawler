import { mkdir, open, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { IOutputSink } from '../../core/interfaces';
import type { StateRecord } from '../../core/types';

export const SITES_DIR = 'storage/sites';
export const STATES_FILE = 'states.json';

/** `2026-10-30T12:16:20.701Z` -> `2026-10-30T12-16-20` (niente ':' nei nomi di file). */
export function folderTimestamp(date: Date): string {
  return date.toISOString().slice(0, 19).replace(/:/g, '-');
}

/**
 * Una cartella per sito, `<sito>_<timestamp>`, con tutti i risultati di quell'analisi:
 *  - states.json: array JSON con un record per stato, valido anche a esplorazione in corso;
 *  - <chiave>.json: ogni saveJson (grafo, risultati dell'estensione), riscritto per intero in modo atomico;
 *  - <chiave>: i file binari (screenshot).
 */
export class FileOutput implements IOutputSink {
  readonly dir: string;
  private ready?: Promise<void>;
  private statesSize = 0;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(site: string, root = SITES_DIR, startedAt = new Date()) {
    this.dir = join(root, `${site}_${folderTimestamp(startedAt)}`);
  }

  /** Le scritture di un sink vanno una alla volta: states.json è un file solo. */
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
      // sovrascrive il "\n]" finale: dopo ogni stato il file è un JSON valido, senza riscriverlo tutto
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
      // scrittura + rename: chi legge (il daemon) non vede mai un file a metà
      await writeFile(`${file}.tmp`, JSON.stringify(value, null, 1));
      await rename(`${file}.tmp`, file);
    });
  }
}
