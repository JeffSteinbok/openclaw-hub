import { describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildCollageFilter, cameraCollageHandler, cameraSnapshot, keyframeAllowed, pruneCameraCaptures, resolveCaptureDir } from "../src/handlers.js";

const six = ["front-doorbell", "front-doorbell-package", "driveway", "backyard-left", "backyard-right", "garage"];

describe("buildCollageFilter", () => {
  it("draws no labels unless asked", () => {
    expect(buildCollageFilter(six, { labels: false, keyframe: false })).not.toContain("drawtext");
    expect(buildCollageFilter(six, { labels: true, keyframe: false })).toContain("drawtext=text='garage'");
  });

  it("stacks the keyframe (input n) above the grid at grid width", () => {
    const f = buildCollageFilter(six, { labels: false, keyframe: true });
    expect(f).toContain("[6:v]scale=1920:-2[key]");
    expect(f).toContain("[key][grid]vstack=inputs=2[out]");
  });

  it("handles a single camera", () => {
    expect(buildCollageFilter(["garage"], { labels: false, keyframe: true })).toContain("[v0]null[grid]");
  });
});

describe("keyframeAllowed", () => {
  it("accepts files under the capture dir or ~/.openclaw/media only", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "home-"));
    const capture = fs.mkdtempSync(path.join(os.tmpdir(), "cap-"));
    const media = path.join(home, ".openclaw", "media", "llmvision");
    fs.mkdirSync(media, { recursive: true });
    const ok1 = path.join(media, "k.jpg"), ok2 = path.join(capture, "c.jpg"), bad = path.join(home, "secret.jpg");
    for (const f of [ok1, ok2, bad]) fs.writeFileSync(f, "x");
    expect(keyframeAllowed(ok1, capture, home)).toBe(true);
    expect(keyframeAllowed(ok2, capture, home)).toBe(true);
    expect(keyframeAllowed(bad, capture, home)).toBe(false);
    expect(keyframeAllowed(path.join(media, "..", "..", "..", "secret.jpg"), capture, home)).toBe(false);
    expect(keyframeAllowed(path.join(capture, "missing.jpg"), capture, home)).toBe(false);
  });
});

const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!hasFfmpeg)("collage render", () => {
  it.each([[6], [5], [1]])("renders %i cameras with a keyframe on top", (count) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "collage-"));
    const inputs: string[] = [];
    for (let i = 0; i <= count; i++) {
      const f = path.join(dir, `in${i}.jpg`);
      execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", `color=c=gray:s=${i === count ? "1280x720" : "1920x1080"}`, "-frames:v", "1", f]);
      inputs.push(f);
    }
    const out = path.join(dir, "out.jpg");
    const names = six.slice(0, count);
    execFileSync("ffmpeg", ["-v", "error", "-y", ...inputs.flatMap((f) => ["-i", f]),
      "-filter_complex", buildCollageFilter(names, { labels: false, keyframe: true }), "-map", "[out]", "-frames:v", "1", out]);
    const [w, h] = execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", out]).toString().trim().split(",").map(Number);
    const cols = Math.ceil(Math.sqrt(count)), rows = Math.ceil(count / cols);
    const gridW = count === 1 ? 640 : cols * 640;
    expect(w).toBe(gridW);
    expect(h).toBe(Math.round((gridW * 720) / 1280 / 2) * 2 + (count === 1 ? 360 : rows * 360));
  });
});


it("honors OpenClaw state and capture directory overrides", () => {
  const old = process.env.OPENCLAW_STATE_DIR;
  try {
    process.env.OPENCLAW_STATE_DIR = path.join(os.tmpdir(), "test-openclaw-state");
    expect(resolveCaptureDir()).toBe(path.join(process.env.OPENCLAW_STATE_DIR, "media", "camera_captures"));
    expect(resolveCaptureDir(os.tmpdir())).toBe(path.resolve(os.tmpdir()));
  } finally {
    if (old === undefined) delete process.env.OPENCLAW_STATE_DIR;
    else process.env.OPENCLAW_STATE_DIR = old;
  }
});

it("prunes only expired generated camera files", () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "capture-retention-")));
  try {
    const oldCapture = path.join(dir, "front-doorbell_2026-11-01T1234.jpg");
    const newCapture = path.join(dir, "collage_2026-11-25T1234.jpg");
    const other = path.join(dir, "keep.jpg");
    const link = path.join(dir, "garage_2026-11-01T1234.jpg");
    for (const file of [oldCapture, newCapture, other]) fs.writeFileSync(file, "");
    const past = new Date(Date.now() - 8 * 86400000);
    fs.utimesSync(oldCapture, past, past);
    fs.utimesSync(other, past, past);
    fs.symlinkSync(other, link);
    pruneCameraCaptures(dir);
    expect(fs.existsSync(oldCapture)).toBe(false);
    expect(fs.readdirSync(dir).sort()).toEqual([path.basename(newCapture), path.basename(link), path.basename(other)].sort());
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

it.skipIf(!hasFfmpeg)("writes a real collage inside the capture directory without following destination links", async () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "capture-output-")));
  const jpeg = path.join(dir, "source.jpg");
  execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=gray:s=320x180", "-frames:v", "1", jpeg]);
  const bytes = fs.readFileSync(jpeg);
  const server = createServer((_request, response) => response.end(bytes));
  try {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("Expected a TCP listener");
    const baseUrl = `http://127.0.0.1:${addr.port}`;
    const captureDir = path.join(dir, "capture");
    const outside = path.join(dir, "outside");
    fs.mkdirSync(outside);
    fs.symlinkSync(outside, captureDir);
    const config = { server: baseUrl, token: "test", captureDir };
    expect(await cameraCollageHandler(config, { camera_names: ["garage"] })).toMatchObject({ error: "All camera snapshots failed" });
    expect(fs.readdirSync(outside)).toEqual([]);
    fs.unlinkSync(captureDir);
    fs.mkdirSync(captureDir);
    vi.setSystemTime(new Date("2026-11-26T15:00:00Z"));
    const victim = path.join(outside, "keep.jpg");
    const output = path.join(captureDir, "collage_2026-11-26T1500.jpg");
    fs.writeFileSync(victim, "untouched");
    fs.symlinkSync(victim, output);
    expect(await cameraSnapshot(baseUrl, "test", "../escape", "camera.garage", captureDir)).toBeNull();
    expect(await cameraCollageHandler(config, { camera_names: ["garage"] })).toMatchObject({ file: output });
    expect(fs.realpathSync(output)).toBe(output);
    expect(fs.readFileSync(output).subarray(0, 3)).toEqual(Buffer.from([255, 216, 255]));
    expect(fs.readFileSync(victim, "utf8")).toBe("untouched");
    expect(fs.readdirSync(captureDir).some((file) => file.startsWith(".capture-"))).toBe(false);
  } finally {
    vi.useRealTimers();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
