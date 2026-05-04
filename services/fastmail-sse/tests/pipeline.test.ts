/**
 * Tests for pipeline rules and formatMessage.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildPipelineRules,
  type RuntimeConfig,
} from "../src/config.js";
import {
  formatMessage,
  ActionRegistry,
  executeRules,
  type MailEnvelope,
  type MailProviderClient,
} from "@openclaw/mail-runtime-core";

describe("TestPipelineRules", () => {
  let testWorkspace: string | null = null;

  afterEach(() => {
    if (testWorkspace) {
      rmSync(testWorkspace, { recursive: true, force: true });
      testWorkspace = null;
    }
  });
  it("should return mail_rules only", () => {
    const config: RuntimeConfig = {
      accounts: {
        acct1: { label: "Personal" },
      },
      mail_rules: [
        {
          id: "usps-informed-delivery",
          accounts: ["acct1"],
          match: {
            sender_domain: "usps.com",
            subject_contains: "Informed Delivery",
          },
          actions: [{ name: "process_usps_digest" }],
          continue: true,
        },
      ],
    };

    const rules = buildPipelineRules(config);
    expect(rules[0].id).toBe("usps-informed-delivery");
    expect(rules).toHaveLength(1);
  });

  it("should prefetch attachments for action", async () => {
    const registry = new ActionRegistry();
    const captured: Record<string, unknown> = {};

    registry.register(
      "needs-attachments",
      (ctx) => {
        captured["download_dir"] = ctx.artifacts["download_dir"];
        captured["files"] = ctx.artifacts["downloaded_files"];
        return [];
      },
      {
        attachment_request: {
          content_types: ["image/*"],
          inline_only: true,
          include_body_html: true,
        },
      },
    );

    const envelope: MailEnvelope = {
      message_id: "m1",
      provider: "fastmail",
      account_id: "acct1",
      mailbox_id: "inbox",
      sender_name: "USPS",
      sender_email: "digest@informeddelivery.usps.com",
      subject: "Your Daily Digest",
    };

    const provider: MailProviderClient = {
      fetchBody: vi.fn().mockResolvedValue(envelope),
      listAttachments: vi.fn().mockResolvedValue([]),
      downloadAttachments: vi
        .fn()
        .mockResolvedValue(["body.html", "scan-1.jpg"]),
    };
    const logger = vi.fn();

    testWorkspace = mkdtempSync(join(tmpdir(), "fastmail-sse-test-"));

    const [matched, results] = await executeRules(
      envelope,
      [
        {
          id: "usps",
          accounts: ["acct1"],
          match: { sender_domain: "usps.com" },
          actions: [{ name: "needs-attachments" }],
        },
      ],
      registry,
      provider,
      { workspace: testWorkspace, logger, config: {} },
    );

    expect(matched).toHaveLength(1);
    expect(results).toEqual([]);
    expect(provider.downloadAttachments).toHaveBeenCalledOnce();
    expect(captured["files"]).toEqual(["body.html", "scan-1.jpg"]);
    expect(captured["download_dir"]).toBeDefined();

    const logMessages = logger.mock.calls.map(
      (c: unknown[]) => c[0] as string,
    );
    expect(
      logMessages.some((m: string) => m.includes("matched mail rule(s): usps")),
    ).toBe(true);
    expect(
      logMessages.some((m: string) =>
        m.includes("running mail action needs-attachments for rule usps"),
      ),
    ).toBe(true);
    expect(
      logMessages.some((m: string) =>
        m.includes("downloaded 2 artifact(s) for action needs-attachments"),
      ),
    ).toBe(true);
  });

  it("should verify mail_runtime_core re-exports core types", () => {
    expect(ActionRegistry).toBeDefined();
    expect(typeof formatMessage).toBe("function");
  });
});

describe("TestFormatMessage", () => {
  it("should format regular email messages", () => {
    const result = formatMessage(
      "John Doe <john@example.com>",
      "john@example.com",
      "Project Update",
    );
    expect(result).not.toBeNull();
    expect(result).toContain("📧");
    expect(result).toContain("John Doe");
    expect(result).toContain("Project Update");
  });

  it("should format email when sender has no name", () => {
    const result = formatMessage(
      "john@example.com",
      "john@example.com",
      "Test",
    );
    expect(result).not.toBeNull();
    expect(result).toContain("john@example.com");
  });

  it("should format accepted calendar responses", () => {
    const result = formatMessage(
      "Jane Smith <jane@example.com>",
      "jane@example.com",
      "accepted: Team Standup",
    );
    expect(result).not.toBeNull();
    expect(result).toContain("👤");
    expect(result).toContain("Jane Smith");
    expect(result).toContain("accepted");
    expect(result).toContain("👍");
    expect(result).toContain("Team Standup");
  });

  it("should format declined calendar responses", () => {
    const result = formatMessage(
      "Bob Wilson <bob@example.com>",
      "bob@example.com",
      "declined: All Hands Meeting",
    );
    expect(result).not.toBeNull();
    expect(result).toContain("👎");
    expect(result).toContain("declined");
  });

  it("should format tentative calendar responses", () => {
    const result = formatMessage(
      "Alice Brown <alice@example.com>",
      "alice@example.com",
      "tentative: Code Review",
    );
    expect(result).not.toBeNull();
    expect(result).toContain("🤷");
    expect(result).toContain("tentative");
  });

  it("should skip emails with 'unsubscribe' in subject", () => {
    const result = formatMessage(
      "Marketing <marketing@example.com>",
      "marketing@example.com",
      "Newsletter - unsubscribe here",
    );
    expect(result).toBeNull();
  });

  it("should skip emails with noreply in subject", () => {
    const result = formatMessage(
      "System <system@example.com>",
      "system@example.com",
      "Message from noreply",
    );
    expect(result).toBeNull();
  });

  it("should apply filters case-insensitively", () => {
    const result = formatMessage(
      "Sender <sender@example.com>",
      "sender@example.com",
      "UNSUBSCRIBE NOW",
    );
    expect(result).toBeNull();
  });
});
