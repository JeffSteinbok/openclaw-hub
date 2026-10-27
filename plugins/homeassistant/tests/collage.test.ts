import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildCollageFilter, keyframeAllowed } from "../src/handlers.js";

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
