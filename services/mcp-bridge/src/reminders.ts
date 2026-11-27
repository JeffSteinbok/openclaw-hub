/** One-shot reminders persisted next to the bridge's paired-device data. */
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

interface Reminder {
  id: string;
  at: number;
  retryAfter?: number;
  destination: string;
  routeKey: string;
  message: string;
}

interface ReminderQueueOptions {
  directory: string;
  prepare: (destination: string, routeKey: string, message: string, id: string) => Promise<() => Promise<void>>;
  log: (message: string) => void;
}

export class ReminderQueue {
  private readonly pending = new Map<string, Reminder>();
  private timer?: ReturnType<typeof setTimeout>;
  private running = false;
  private stopped = false;

  constructor(private readonly options: ReminderQueueOptions) {
    if (fs.mkdirSync(options.directory, { recursive: true, mode: 0o700 })) {
      this.syncDirectory(path.dirname(options.directory));
    }
    for (const file of fs.readdirSync(options.directory)) {
      if (file.endsWith(".sending")) {
        options.log("a reminder has unconfirmed delivery; automatic replay is disabled");
      }
      if (!/^[a-f0-9]{32}\.json$/.test(file)) continue;
      try {
        const job = JSON.parse(fs.readFileSync(path.join(options.directory, file), "utf8")) as Reminder;
        if (file !== `${job.id}.json` || !Number.isFinite(job.at) ||
            typeof job.destination !== "string" || typeof job.routeKey !== "string" || typeof job.message !== "string") {
          throw new Error("invalid reminder");
        }
        this.pending.set(job.id, job);
      } catch {
        options.log("could not load a saved reminder");
      }
    }
    this.arm();
  }

  schedule(at: number, destination: string, routeKey: string, message: string): string {
    const data = { at, destination, routeKey, message };
    const id = createHash("sha256").update(JSON.stringify(data)).digest("hex").slice(0, 32);
    if (this.pending.has(id) || fs.existsSync(this.file(id, "sending"))) return id;
    const job = { id, ...data };
    const temp = this.file(randomUUID(), "tmp");
    try {
      fs.writeFileSync(temp, JSON.stringify(job), { mode: 0o600, flag: "wx", flush: true });
      const saved = this.file(id, "json");
      fs.renameSync(temp, saved);
      try {
        this.syncDirectory();
      } catch (error) {
        fs.rmSync(saved, { force: true });
        throw error;
      }
    } finally {
      fs.rmSync(temp, { force: true });
    }
    this.pending.set(id, job);
    this.arm();
    return id;
  }

  close(): void {
    this.stopped = true;
    clearTimeout(this.timer);
  }

  private file(id: string, extension: string): string {
    return path.join(this.options.directory, `${id}.${extension}`);
  }

  private syncDirectory(directory = this.options.directory): void {
    const fd = fs.openSync(directory, "r");
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  }

  private arm(): void {
    clearTimeout(this.timer);
    if (this.running || this.stopped) return;
    const readyAt = (job: Reminder) => Math.max(job.at, job.retryAfter ?? 0);
    const next = [...this.pending.values()].reduce<Reminder | undefined>(
      (earliest, job) => !earliest || readyAt(job) < readyAt(earliest) ? job : earliest, undefined,
    );
    if (!next) return;
    this.timer = setTimeout(() => void this.deliver(next), Math.min(60_000, Math.max(0, readyAt(next) - Date.now())));
    this.timer.unref();
  }

  private async deliver(job: Reminder): Promise<void> {
    if (Math.max(job.at, job.retryAfter ?? 0) > Date.now()) {
      this.arm();
      return;
    }
    this.running = true;
    try {
      await this.attempt(job);
    } finally {
      this.running = false;
      this.arm();
    }
  }

  private async attempt(job: Reminder): Promise<void> {
    let send: () => Promise<void>;
    try {
      send = await this.options.prepare(job.destination, job.routeKey, job.message, `mcp-reminder:${job.id}`);
    } catch {
      job.retryAfter = Date.now() + 5000;
      this.options.log(`could not prepare reminder delivery id=${job.id}; retrying`);
      return;
    }

    const sending = this.file(job.id, "sending");
    try {
      // Claim before sending. After a crash or timeout, delivery is ambiguous.
      fs.renameSync(this.file(job.id, "json"), sending);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        this.pending.delete(job.id);
      } else {
        job.retryAfter = Date.now() + 5000;
        this.options.log(`could not claim reminder id=${job.id}; retrying`);
      }
      return;
    }
    try {
      this.syncDirectory();
    } catch {
      try {
        fs.renameSync(sending, this.file(job.id, "json"));
        job.retryAfter = Date.now() + 5000;
        this.options.log(`could not sync reminder claim id=${job.id}; retrying`);
      } catch {
        this.pending.delete(job.id);
        this.options.log(`could not restore reminder claim id=${job.id}`);
      }
      return;
    }
    this.pending.delete(job.id);
    try {
      await send();
      fs.unlinkSync(sending);
      this.syncDirectory();
      this.options.log(`delivered reminder id=${job.id}`);
    } catch {
      this.options.log(`reminder delivery unconfirmed id=${job.id}`);
    }
  }
}
