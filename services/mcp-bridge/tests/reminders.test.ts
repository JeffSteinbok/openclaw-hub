import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ReminderQueue } from "../src/reminders.js";

let directory: string;
const log = vi.fn();
const deliver = vi.fn<(destination: string, routeKey: string, message: string, id: string) => Promise<void>>();

beforeEach(() => {
  vi.useFakeTimers();
  log.mockReset();
  deliver.mockReset();
  directory = mkdtempSync(join(tmpdir(), "mcp-reminders-"));
});

afterEach(() => {
  vi.useRealTimers();
  rmSync(directory, { recursive: true, force: true });
});

it("persists and deduplicates a job, then delivers it through the configured path after restart", async () => {
  const original = new ReminderQueue({ directory, deliver, log });
  const at = Date.now() + 2000;
  const id = original.schedule(at, "owner", "route", "Call home");
  expect(original.schedule(at, "owner", "route", "Call home")).toBe(id);
  expect(readdirSync(directory)).toEqual([`${id}.json`]);
  expect(statSync(join(directory, `${id}.json`)).mode & 0o777).toBe(0o600);
  original.close();
  const resumed = new ReminderQueue({ directory, deliver, log });
  try {
    await vi.advanceTimersByTimeAsync(1999);
    expect(deliver).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(deliver).toHaveBeenCalledExactlyOnceWith("owner", "route", "Call home", `mcp-reminder:${id}`);
    expect(readdirSync(directory)).toEqual([]);
  } finally {
    resumed.close();
  }
});

it("retains ambiguous deliveries for inspection without replaying them on restart", async () => {
  deliver.mockRejectedValue(new Error("ambiguous failure"));
  const original = new ReminderQueue({ directory, deliver, log });
  const id = original.schedule(Date.now() + 1000, "owner", "route", "Call home");
  await vi.advanceTimersByTimeAsync(1000);
  original.close();
  expect(readdirSync(directory)).toEqual([`${id}.sending`]);
  expect(log).toHaveBeenCalledWith(`reminder delivery unconfirmed id=${id}`);
  const resumed = new ReminderQueue({ directory, deliver, log });
  try {
    await vi.advanceTimersByTimeAsync(1000);
    expect(deliver).toHaveBeenCalledTimes(1);
  } finally {
    resumed.close();
  }
});
