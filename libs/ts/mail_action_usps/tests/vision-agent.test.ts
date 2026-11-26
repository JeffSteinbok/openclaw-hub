import { describe, it, expect, vi, beforeEach } from "vitest";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const execFileSync = vi.fn();
vi.mock("node:child_process", () => ({ execFileSync }));

const home = mkdtempSync(join(tmpdir(), "usps-vision-home-"));
vi.mock("node:os", async (orig) => ({ ...(await orig<typeof import("node:os")>()), homedir: () => home }));

const { withWorkspaceConfig } = await import("../src/paths.js");
const { analyzeViaAgent } = await import("../src/vision.js");

function scan(): string {
  const dir = mkdtempSync(join(tmpdir(), "usps-scan-"));
  const file = join(dir, "1001-01.jpg");
  writeFileSync(file, "jpeg");
  return file;
}

beforeEach(() => {
  execFileSync.mockReset();
  execFileSync.mockReturnValue(JSON.stringify({ result: { payloads: [{ text: '{"sender":"ACME"}' }] } }));
});

describe("analyzeViaAgent", () => {
  it("uses the given session key", () => {
    expect(analyzeViaAgent(scan(), "mail", "agent:mail:usps-vision-2024-01-15")).toEqual({ sender: "ACME" });
    const args = execFileSync.mock.calls[0][1] as string[];
    expect(args.slice(0, 5)).toEqual(["agent", "--agent", "mail", "--session-key", "agent:mail:usps-vision-2024-01-15"]);
  });

  it("omits --session-key when none is given", () => {
    analyzeViaAgent(scan(), "mail");
    expect(execFileSync.mock.calls[0][1]).not.toContain("--session-key");
  });
});


it("stages the scan in the configured vision workspace and removes it afterward", () => {
  const workspace = join(home, "configured-vision");
  const staged = join(workspace, "camera_captures", "usps-scan-1001-01.jpg");
  execFileSync.mockImplementationOnce(() => {
    expect(existsSync(staged)).toBe(true);
    return JSON.stringify({ result: { payloads: [{ text: '{"sender":"Example"}' }] } });
  });
  withWorkspaceConfig({ agents: { entries: { vision: { workspace } } } }, () => {
    expect(analyzeViaAgent(scan(), "vision")).toEqual({ sender: "Example" });
  });
  expect(existsSync(staged)).toBe(false);
});
