import { copyFile, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { emptyState, type HealthState, type LocalDateTime } from "@clearcare/domain";

/**
 * The system of record: one JSON file, written atomically (a temporary file, then a rename) with owner-only
 * permissions. Writes are serialized. Before the first write of each day, the current file is copied to backups/.
 */
export class Store {
  private state: HealthState;
  private queue: Promise<unknown> = Promise.resolve();

  private constructor(
    readonly file: string,
    private readonly backups: string,
    state: HealthState,
  ) {
    this.state = state;
  }

  static async open(dataDir: string, now: LocalDateTime): Promise<Store> {
    await mkdir(dataDir, { recursive: true, mode: 0o700 });
    const file = path.join(dataDir, "health.json");
    const backups = path.join(dataDir, "backups");
    let state = emptyState(now);
    if (existsSync(file)) {
      const parsed = JSON.parse(await readFile(file, "utf8")) as Partial<HealthState>;
      if (parsed.schema !== 1) throw new Error(`${file} has schema ${String(parsed.schema)}; this version reads schema 1.`);
      // Fields added in later versions start empty.
      state = { ...emptyState(now), ...parsed } as HealthState;
    }
    return new Store(file, backups, state);
  }

  get(): HealthState {
    return this.state;
  }

  /** Runs one change at a time. The function returns the new state; nothing is saved if it throws. */
  update<T>(change: (state: HealthState) => { readonly state: HealthState; readonly result: T }): Promise<T> {
    const next = this.queue.then(async () => {
      const { state, result } = change(this.state);
      if (state !== this.state) {
        await this.backupOncePerDay();
        await this.write(state);
        this.state = state;
      }
      return result;
    });
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async write(state: HealthState): Promise<void> {
    const tmp = `${this.file}.${process.pid}.tmp`;
    await writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    await rename(tmp, this.file);
  }

  private async backupOncePerDay(): Promise<void> {
    if (!existsSync(this.file)) return;
    await mkdir(this.backups, { recursive: true, mode: 0o700 });
    const day = new Date().toLocaleDateString("en-CA");
    const target = path.join(this.backups, `health-${day}.json`);
    if (existsSync(target)) return;
    await copyFile(this.file, target);
    const files = (await readdir(this.backups)).filter((f) => /^health-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
    for (const old of files.slice(0, Math.max(0, files.length - 30))) await rm(path.join(this.backups, old));
  }
}
