import { execFile } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const cli = fileURLToPath(new URL("../dist/bin/outlook-work-calendar.js", import.meta.url));
const server = createServer((req, res) => {
  req.resume();
  res.end(JSON.stringify({
    Body: { ResponseMessages: { Items: [{ RootFolder: { Items: [] } }] } },
  }));
});
let calendarUrl: string;

beforeAll(async () => {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected a TCP server address");
  calendarUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  if (server.listening) {
    server.close();
    await once(server, "close");
  }
});

async function fetchViaCli(args: string[]) {
  const { stdout } = await execFileAsync(process.execPath, [cli, "outlook-work-calendar-fetch", ...args, "--json"], {
    env: {
      ...process.env,
      OUTLOOK_WORK_CALENDAR_CALENDAR_URL: calendarUrl,
      OUTLOOK_WORK_CALENDAR_FOLDER_ID: "test-folder",
    },
  });
  return JSON.parse(stdout);
}

describe("work calendar CLI days", () => {
  it.each([
    { form: "positional", args: ["28"] },
    { form: "flag", args: ["--days", "28"] },
  ])("accepts a 28-day window in $form form", async ({ args }) => {
    const result = await fetchViaCli(args);
    expect(result.count).toBe(0);
    expect(Date.parse(result.end_date) - Date.parse(result.start_date)).toBe(27 * 86_400_000);
  });

  it.each(["2.5", "0", "-1", "0x1c", "1e1", "29"])("rejects days=%s", async (value) => {
    const result = await fetchViaCli([`--days=${value}`]);
    expect(result.error).toMatch(/positive integer|coverage is limited/);
  });
});
