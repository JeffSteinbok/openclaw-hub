import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { playwrightChromiums, resolvedPaths } from "../src/pdf-handlers.js";

async function touch(path: string) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, "");
}

describe("playwrightChromiums", () => {
  it("lists the newest revision first", async () => {
    const cache = await mkdtemp(join(tmpdir(), "pw-"));
    const app = "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
    await touch(join(cache, "chromium-1223", "chrome-mac-arm64", app));
    await touch(join(cache, "chromium-1248", "chrome-mac-arm64", app));
    await touch(join(cache, "chromium_headless_shell-1248", "chrome-mac-arm64", "x"));
    expect(await playwrightChromiums(cache)).toEqual([
      join(cache, "chromium-1248", "chrome-mac-arm64", app),
      join(cache, "chromium-1223", "chrome-mac-arm64", app),
    ]);
  });

  it("returns nothing without a cache", async () => {
    expect(await playwrightChromiums(join(tmpdir(), "no-such-cache"))).toEqual([]);
  });
});

describe("resolvedPaths", () => {
  it("puts CHROMIUM_PATH first", async () => {
    const bin = join(await mkdtemp(join(tmpdir(), "bin-")), "chromium");
    await touch(bin);
    expect((await resolvedPaths({ CHROMIUM_PATH: bin }))[0]).toBe(bin);
  });

  it("ignores a CHROMIUM_PATH that doesn't exist", async () => {
    expect(await resolvedPaths({ CHROMIUM_PATH: "/no/such/chromium" })).not.toContain("/no/such/chromium");
  });
});
