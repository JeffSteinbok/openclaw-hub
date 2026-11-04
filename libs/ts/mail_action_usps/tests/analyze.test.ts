import { describe, it, expect, vi, beforeEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const h = vi.hoisted(() => ({
  home: "",
  analyzeViaAgent: vi.fn(),
  execFileSync: vi.fn(),
}));

vi.mock("node:os", async (orig) => ({
  ...(await orig<typeof import("node:os")>()),
  homedir: () => h.home,
}));
vi.mock("node:child_process", async (orig) => ({
  ...(await orig<typeof import("node:child_process")>()),
  execFileSync: h.execFileSync,
}));
vi.mock("../src/vision.js", async (orig) => ({
  ...(await orig<typeof import("../src/vision.js")>()),
  analyzeViaAgent: h.analyzeViaAgent,
}));

import { listScanImages, processDigest } from "../src/analyze.js";
import { processUspsDigestAction } from "../src/register.js";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function digestHtml(mailCount: number, cids: string[]): string {
  return (
    `<html><body><p>Saturday, January 13, 2024</p>` +
    `<p>You have ${mailCount} mailpiece(s) arriving soon.</p>` +
    cids.map((c) => `<img src="cid:${c}" />`).join("") +
    `<img src="https://informeddelivery.usps.com/logo.png" /></body></html>`
  );
}

function makeFolder(html: string, files: Record<string, Buffer> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "usps-digest-"));
  writeFileSync(join(dir, "body.html"), html);
  for (const [name, data] of Object.entries(files)) writeFileSync(join(dir, name), data);
  return dir;
}

function writeConfig(target: string) {
  const dir = join(h.home, ".openclaw", "agents", "ws", "workspace", "usps-mail");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "config.json"),
    JSON.stringify({ routing: { default: { channel: "discord", target } } }),
  );
}

const stateFile = () =>
  join(h.home, ".openclaw", "agents", "ws", "workspace", "memory", "usps_state.json");
const memoryFile = () =>
  join(h.home, ".openclaw", "agents", "mem", "workspace", "memory", "mail", "mail_memory_2024-01.md");

const baseOpts = {
  workspaceAgent: "ws",
  memoryAgent: "mem",
  visionAgent: "mail",
  messageId: "msg-1",
};

beforeEach(() => {
  h.home = mkdtempSync(join(tmpdir(), "usps-home-"));
  h.analyzeViaAgent.mockReset();
  h.execFileSync.mockReset();
});

describe("listScanImages", () => {
  it("keeps USPS scans and cid-named images, drops ads", () => {
    const dir = makeFolder("<html></html>", {
      "1025359682-062.jpg": JPEG,
      "1025359682-063.JPEG": JPEG,
      "mailer-12345.jpg": JPEG,
      "content-logo.png": PNG,
      "banner.png": PNG,
      "image001.jpg": JPEG,
    });
    expect(listScanImages(dir, ["image001.jpg@01DA0000"])).toEqual([
      "1025359682-062.jpg",
      "1025359682-063.JPEG",
      "image001.jpg",
    ]);
  });

  it("accepts <cid>.bin parts only when they are images", () => {
    const dir = makeFolder("<html></html>", {
      "abc123@usps.gov.bin": JPEG,
      "def456@usps.gov.bin": Buffer.from("not an image"),
      "other.bin": PNG,
    });
    expect(listScanImages(dir, ["abc123@usps.gov", "def456@usps.gov"])).toEqual([
      "abc123@usps.gov.bin",
    ]);
  });
});

describe("processDigest", () => {
  it("does not record a digest with mail pieces but no scan images", async () => {
    const dir = makeFolder(digestHtml(2, ["1025359682-062.jpg"]), {
      "mailer-12345.jpg": JPEG,
    });
    const result = await processDigest({ folder: dir, ...baseOpts });
    expect(result.incomplete).toBe(true);
    expect(result.reason).toMatch(/no scan images/);
    expect(h.analyzeViaAgent).not.toHaveBeenCalled();
    expect(existsSync(stateFile())).toBe(false);
    expect(existsSync(memoryFile())).toBe(false);
  });

  it("does not record a digest when every vision call fails", async () => {
    const dir = makeFolder(digestHtml(1, []), { "1025359682-062.jpg": JPEG });
    h.analyzeViaAgent.mockImplementation(() => {
      throw new Error("agent timeout");
    });
    const result = await processDigest({ folder: dir, ...baseOpts });
    expect(result.incomplete).toBe(true);
    expect(result.reason).toMatch(/vision analysis failed/);
    expect(existsSync(stateFile())).toBe(false);
  });

  it("handles a digest with zero mail pieces normally", async () => {
    const dir = makeFolder(digestHtml(0, []));
    const result = await processDigest({ folder: dir, ...baseOpts });
    expect(result.incomplete).toBeUndefined();
    expect(result.images_analyzed).toBe(0);
    expect(existsSync(stateFile())).toBe(true);
  });

  it("records a failed vision call as a failure, not routine mail", async () => {
    const dir = makeFolder(digestHtml(2, []), {
      "1025359682-062.jpg": JPEG,
      "1025359682-063.jpg": JPEG,
    });
    h.analyzeViaAgent
      .mockReturnValueOnce({ sender: "Bank", addressee: "Jeff", importance: "low" })
      .mockImplementationOnce(() => {
        throw new Error("agent timeout");
      });
    const result = await processDigest({ folder: dir, ...baseOpts });
    expect(result.images_analyzed).toBe(1);
    expect(result.importance_breakdown).toEqual({ low: 1, unknown: 1 });
    const failures = result.vision_failures as Array<Record<string, string>>;
    expect(failures).toHaveLength(1);
    expect(failures[0].image).toBe("1025359682-063.jpg");
    expect(failures[0].error).toContain("agent timeout");
    const failed = (result.structured_items as Array<Record<string, unknown>>)[1];
    expect(failed.importance).toBe("unknown");
    expect(failed.description).toBe("Vision analysis failed");
  });

  it("counts only notifications that were actually sent", async () => {
    writeConfig("jeff-target");
    const dir = makeFolder(digestHtml(1, []), { "1025359682-062.jpg": JPEG });
    h.analyzeViaAgent.mockReturnValue({ sender: "IRS", addressee: "Jeff", importance: "urgent" });

    h.execFileSync.mockImplementation(() => {
      throw new Error("send failed");
    });
    const failed = await processDigest({ folder: dir, ...baseOpts, writeMemory: false });
    expect((failed.notification_plan as unknown[]).length).toBe(1);
    expect(failed.notifications_sent).toBe(0);

    h.execFileSync.mockReturnValue("");
    const sent = await processDigest({ folder: dir, ...baseOpts, writeMemory: false });
    expect(sent.notifications_sent).toBe(1);
  });
});

describe("processUspsDigestAction", () => {
  function ctx(dir: string) {
    return {
      artifacts: { download_dir: dir, downloaded_files: ["body.html"] },
      envelope: { subject: "Your Daily Digest", sender_email: "usps@example.com", message_id: "msg-1" },
      logger: vi.fn(),
    } as never;
  }
  const params = { workspace_agent: "ws", memory_agent: "mem", vision_agent: "mail", agent: "main" };

  it("tells Jeff and skips the handoff when no scans were analyzed", async () => {
    const dir = makeFolder(digestHtml(2, ["1025359682-062.jpg"]));
    const results = await processUspsDigestAction(ctx(dir), params);
    expect(results.map((r) => r.kind)).toEqual(["log", "message"]);
    expect(results[1].payload.message).toMatch(/could not be analyzed/);
    expect(existsSync(stateFile())).toBe(false);
  });

  it("surfaces vision failures in the summary and handoff", async () => {
    const dir = makeFolder(digestHtml(2, []), {
      "1025359682-062.jpg": JPEG,
      "1025359682-063.jpg": JPEG,
    });
    h.analyzeViaAgent
      .mockReturnValueOnce({ sender: "Bank", addressee: "Jeff", importance: "low" })
      .mockImplementationOnce(() => {
        throw new Error("agent timeout");
      });
    const results = await processUspsDigestAction(ctx(dir), params);
    const handoff = results.find((r) => r.kind === "agent_handoff")!;
    expect(handoff.payload.summary).toContain("1 vision failure(s)");
    expect(handoff.payload.message).toContain("vision_failures");
    expect(readFileSync(memoryFile(), "utf-8")).toContain("Vision analysis failed");
  });
});
