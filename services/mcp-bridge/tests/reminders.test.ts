import fs, { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ReminderQueue } from "../src/reminders.js";

let directory: string;
const log = vi.fn();
const deliver = vi.fn<(destination: string, routeKey: string, message: string, id: string) => Promise<void>>();

const prepare = vi.fn(async (destination: string, routeKey: string, message: string, id: string) =>
  (onSent: () => void) => {
    onSent();
    return deliver(destination, routeKey, message, id);
  },
);

beforeEach(() => {
  vi.useFakeTimers();
  log.mockReset();
  deliver.mockReset();
  prepare.mockClear();
  directory = mkdtempSync(join(tmpdir(), "mcp-reminders-"));
});

afterEach(() => {
  vi.useRealTimers();
  rmSync(directory, { recursive: true, force: true });
});

it("persists and deduplicates a job, then delivers it through the configured path after restart", async () => {
  const original = new ReminderQueue({ directory, prepare, log });
  const at = Date.now() + 2000;
  const id = original.schedule(at, "owner", "route", "Call home");
  expect(original.schedule(at, "owner", "route", "Call home")).toBe(id);
  expect(readdirSync(directory)).toEqual([`${id}.json`]);
  expect(statSync(join(directory, `${id}.json`)).mode & 0o777).toBe(0o600);
  original.close();
  const resumed = new ReminderQueue({ directory, prepare, log });
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
  const original = new ReminderQueue({ directory, prepare, log });
  const id = original.schedule(Date.now() + 1000, "owner", "route", "Call home");
  await vi.advanceTimersByTimeAsync(1000);
  original.close();
  expect(readdirSync(directory)).toEqual([`${id}.sending`]);
  expect(log).toHaveBeenCalledWith(`reminder delivery unconfirmed id=${id}`);
  const resumed = new ReminderQueue({ directory, prepare, log });
  try {
    await vi.advanceTimersByTimeAsync(1000);
    expect(deliver).toHaveBeenCalledTimes(1);
  } finally {
    resumed.close();
  }
});

it("keeps a reminder pending when its claim fails and allows other reminders through", async () => {
  const queue = new ReminderQueue({ directory, prepare, log });
  queue.schedule(Date.now() + 1000, "owner", "route", "Retry me");
  queue.schedule(Date.now() + 2000, "owner", "route", "Second reminder");
  const claim = vi.spyOn(fs, "renameSync").mockImplementationOnce(() => {
    throw Object.assign(new Error("temporarily unavailable"), { code: "EBUSY" });
  });
  try {
    await vi.advanceTimersByTimeAsync(1000);
    expect(deliver).not.toHaveBeenCalled();
    expect(readdirSync(directory)).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(deliver.mock.calls.map((call) => call[2])).toEqual(["Second reminder"]);
    await vi.advanceTimersByTimeAsync(4000);
    expect(deliver.mock.calls.map((call) => call[2])).toEqual(["Second reminder", "Retry me"]);
  } finally {
    claim.mockRestore();
    queue.close();
  }
});

it("retries preflight failures when no send was attempted", async () => {
  prepare.mockRejectedValueOnce(new Error("Gateway offline"));
  const queue = new ReminderQueue({ directory, prepare, log });
  const id = queue.schedule(Date.now() + 1000, "owner", "route", "Call home");
  try {
    await vi.advanceTimersByTimeAsync(1000);
    expect(readdirSync(directory)).toEqual([`${id}.json`]);
    expect(deliver).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5000);
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(readdirSync(directory)).toEqual([]);
  } finally {
    queue.close();
  }
});

it("restores the pending job if syncing its claim fails before sending", async () => {
  const queue = new ReminderQueue({ directory, prepare, log });
  const id = queue.schedule(Date.now() + 1000, "owner", "route", "Call home");
  const sync = vi.spyOn(fs, "fsyncSync").mockImplementationOnce(() => { throw new Error("temporary sync error"); });
  try {
    await vi.advanceTimersByTimeAsync(1000);
    expect(readdirSync(directory)).toEqual([`${id}.json`]);
    expect(deliver).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5000);
    expect(deliver).toHaveBeenCalledTimes(1);
  } finally {
    sync.mockRestore();
    queue.close();
  }
});

it("retries a disconnect that happened before the request was sent", async () => {
  prepare.mockResolvedValueOnce(async () => { throw new Error("Gateway disconnected"); });
  const queue = new ReminderQueue({ directory, prepare, log });
  const id = queue.schedule(Date.now() + 1000, "owner", "route", "Call home");
  try {
    await vi.advanceTimersByTimeAsync(1000);
    expect(readdirSync(directory)).toEqual([`${id}.json`]);
    await vi.advanceTimersByTimeAsync(5000);
    expect(deliver).toHaveBeenCalledTimes(1);
  } finally {
    queue.close();
  }
});

it("starts another due reminder while a send awaits confirmation", async () => {
  let finishSlow!: () => void;
  deliver.mockImplementationOnce(() => new Promise<void>((resolve) => { finishSlow = resolve; }));
  const queue = new ReminderQueue({ directory, prepare, log });
  queue.schedule(Date.now() + 1000, "owner", "route", "Slow");
  queue.schedule(Date.now() + 2000, "owner", "route", "Fast");
  try {
    await vi.advanceTimersByTimeAsync(2000);
    expect(deliver.mock.calls.map((call) => call[2])).toEqual(["Slow", "Fast"]);
    finishSlow();
    await vi.advanceTimersByTimeAsync(0);
    expect(readdirSync(directory)).toEqual([]);
  } finally {
    queue.close();
  }
});

it("retries restoring an unsent claim before attempting delivery again", async () => {
  prepare.mockResolvedValueOnce(async () => { throw new Error("Gateway disconnected"); });
  const queue = new ReminderQueue({ directory, prepare, log });
  const id = queue.schedule(Date.now() + 1000, "owner", "route", "Call home");
  const originalRename = fs.renameSync;
  const rename = vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
    if (String(from).endsWith(".sending")) throw new Error("temporarily unable to restore");
    originalRename(from, to);
  });
  try {
    await vi.advanceTimersByTimeAsync(1000);
    expect(readdirSync(directory)).toEqual([`${id}.sending`]);
    expect(deliver).not.toHaveBeenCalled();
    rename.mockRestore();
    await vi.advanceTimersByTimeAsync(5000);
    expect(readdirSync(directory)).toEqual([`${id}.json`]);
    expect(deliver).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5000);
    expect(deliver).toHaveBeenCalledTimes(1);
  } finally {
    rename.mockRestore();
    queue.close();
  }
});
