/**
 * Tests for email send and meeting commands.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { FastmailConfig } from "../src/config.js";

const mockFetch = vi.fn();

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function makeCfg(overrides: Partial<FastmailConfig> = {}): FastmailConfig {
  return {
    accountId: "acct1",
    jmapToken: "test-token",
    fromEmail: "sender@example.com",
    fromName: "Test Sender",
    identityId: "ident1",
    draftsId: "drafts-id",
    sentId: "sent-id",
    caldavUrl: "https://caldav.example.com/",
    caldavUsername: "user@example.com",
    caldavPassword: "secret",
    caldavCalendarPath: "/dav/calendars/user/user@example.com/default/",
    ...overrides,
  };
}

function makeJmapOk() {
  return {
    ok: true,
    json: () =>
      Promise.resolve({
        methodResponses: [
          ["Email/set", { created: { e: { id: "created-id" } } }, "create"],
          ["EmailSubmission/set", { created: { s: {} } }, "submit"],
        ],
      }),
  };
}

describe("cmdSend()", () => {
  it("sends a plain text email via JMAP", async () => {
    mockFetch.mockResolvedValueOnce(makeJmapOk());

    const { cmdSend } = await import("../src/email.js");
    const output = await cmdSend(makeCfg(), {
      to: "recipient@example.com",
      subject: "Test Subject",
      body: "Hello World",
    });

    expect(output).toContain("✓ Sent to recipient@example.com");
    expect(output).toContain("Test Subject");

    // Verify the JMAP call
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.fastmail.com/jmap/api/");
    const body = JSON.parse(opts.body);
    expect(body.methodCalls[0][0]).toBe("Email/set");
    expect(body.methodCalls[1][0]).toBe("EmailSubmission/set");
  });

  it("sends to multiple recipients", async () => {
    mockFetch.mockResolvedValueOnce(makeJmapOk());

    const { cmdSend } = await import("../src/email.js");
    const output = await cmdSend(makeCfg(), {
      to: ["a@example.com", "b@example.com"],
      subject: "Multi",
      body: "Test",
    });

    expect(output).toContain("a@example.com, b@example.com");
  });

  it("appends signature to body", async () => {
    mockFetch.mockResolvedValueOnce(makeJmapOk());

    const { cmdSend } = await import("../src/email.js");
    await cmdSend(makeCfg(), {
      to: "r@example.com",
      subject: "Sig Test",
      body: "Main body",
      signature: "-- Best regards",
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    const emailCreate = body.methodCalls[0][1].create.e;
    expect(emailCreate.bodyValues["1"].value).toContain("Main body");
    expect(emailCreate.bodyValues["1"].value).toContain("-- Best regards");
  });

  it("sets In-Reply-To and References headers for threading", async () => {
    mockFetch.mockResolvedValueOnce(makeJmapOk());

    const { cmdSend } = await import("../src/email.js");
    await cmdSend(makeCfg(), {
      to: "r@example.com",
      subject: "Re: Thread Subject",
      body: "Reply body",
      in_reply_to: "<parent@mail.example.com>",
      references: "<root@mail.example.com> <parent@mail.example.com>",
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    const emailCreate = body.methodCalls[0][1].create.e;
    expect(emailCreate.inReplyTo).toEqual(["<parent@mail.example.com>"]);
    expect(emailCreate.references).toEqual(["<root@mail.example.com>", "<parent@mail.example.com>"]);
  });

  it("handles JMAP errors gracefully", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          methodResponses: [
            ["error", { type: "serverFail", description: "Internal error" }, "create"],
          ],
        }),
    });

    const { cmdSend } = await import("../src/email.js");
    await expect(
      cmdSend(makeCfg(), { to: "r@example.com", subject: "Test", body: "body" }),
    ).rejects.toThrow("JMAP error");
  });
});

describe("cmdMeeting()", () => {
  it("creates a calendar event via CalDAV", async () => {
    // Mock CalDAV PUT
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      text: () => Promise.resolve(""),
      headers: new Map([["etag", '"abc"']]),
    });

    const { cmdMeeting } = await import("../src/email.js");
    const output = await cmdMeeting(makeCfg(), {
      to: "attendee@example.com",
      subject: "Sprint Planning",
      start: "2026-03-20T10:00:00",
      duration: "1h",
      timezone: "America/Los_Angeles",
    });

    expect(output).toContain("✓ Calendar event created via CalDAV");
    expect(output).toContain("Sprint Planning");
    expect(output).toContain("UID:");
  });

  it("errors when CalDAV not configured", async () => {
    const { cmdMeeting } = await import("../src/email.js");
    await expect(
      cmdMeeting(makeCfg({ caldavUrl: "", caldavPassword: "" }), {
        to: "a@example.com",
        subject: "Test",
        start: "2026-03-20T10:00:00",
      }),
    ).rejects.toThrow("CalDAV not configured");
  });

  it("errors on invalid start datetime", async () => {
    const { cmdMeeting } = await import("../src/email.js");
    await expect(
      cmdMeeting(makeCfg(), {
        to: "a@example.com",
        subject: "Test",
        start: "not-a-date",
      }),
    ).rejects.toThrow("Invalid start datetime");
  });
});

describe("cmdQueryEvents()", () => {
  it("errors when CalDAV not configured", async () => {
    const { cmdQueryEvents } = await import("../src/email.js");
    await expect(
      cmdQueryEvents(makeCfg({ caldavUrl: "", caldavPassword: "" }), {}),
    ).rejects.toThrow("CalDAV");
  });
});
