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

  it("uses an explicit end instead of the 1h default", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      text: () => Promise.resolve(""),
      headers: new Map([["etag", '"abc"']]),
    });

    const { cmdMeeting } = await import("../src/email.js");
    await cmdMeeting(makeCfg(), {
      to: "attendee@example.com",
      subject: "Long Review",
      start: "2026-03-20T10:00:00",
      end: "2026-03-20T11:30:00",
      timezone: "America/Los_Angeles",
    });

    const body = String(mockFetch.mock.calls.at(-1)?.[1]?.body ?? "");
    expect(body).toContain("DTEND;TZID=America/Los_Angeles:20260320T113000");
  });

  it("rejects an end before the start", async () => {
    const { cmdMeeting } = await import("../src/email.js");
    await expect(
      cmdMeeting(makeCfg(), {
        to: "a@example.com",
        subject: "Test",
        start: "2026-03-20T10:00:00",
        end: "2026-03-20T09:00:00",
      }),
    ).rejects.toThrow("must be after start");
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

describe("custom headers", () => {
  it("validates and encodes", async () => {
    const { validateCustomHeaders } = await import("../src/email.js");
    expect(validateCustomHeaders({ "X-Octo-Source": "usps", "Reply-To": "jeff@example.com" })).toEqual([
      ["X-Octo-Source", "usps"],
      ["Reply-To", "jeff@example.com"],
    ]);
    expect(validateCustomHeaders({ "X-Note": "café" })[0][1]).toBe("=?UTF-8?B?Y2Fmw6k=?=");
    expect(validateCustomHeaders(undefined)).toEqual([]);
  });

  it("refuses reserved, malformed, injected and oversized headers", async () => {
    const { validateCustomHeaders } = await import("../src/email.js");
    for (const name of ["From", "bcc", "Subject", "Message-ID", "Content-Type", "Content-Foo", "DKIM-Signature", "Return-Path"]) {
      expect(() => validateCustomHeaders({ [name]: "x" })).toThrow(/can't be set/);
    }
    expect(() => validateCustomHeaders({ "Bad Name": "x" })).toThrow(/Invalid header name/);
    expect(() => validateCustomHeaders({ "X-A:": "x" })).toThrow(/Invalid header name/);
    expect(() => validateCustomHeaders({ "X-A": "ok\r\nBcc: evil@example.com" })).toThrow(/line break/);
    expect(() => validateCustomHeaders({ "Reply-To": "Jéff <j@example.com>" })).toThrow(/plain ASCII/);
    expect(() => validateCustomHeaders({ "X-A": "x".repeat(1000) })).toThrow(/too long/);
    expect(() => validateCustomHeaders({ "X-A": "1", "x-a": "2" })).toThrow(/Duplicate/);
    const many = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`X-H${i}`, "v"]));
    expect(() => validateCustomHeaders(many)).toThrow(/At most 20/);
  });

  it("sets them as raw JMAP header properties on a plain send", async () => {
    mockFetch.mockResolvedValueOnce(makeJmapOk());
    const { cmdSend } = await import("../src/email.js");
    await cmdSend(makeCfg(), { to: "r@example.com", subject: "S", body: "B", headers: { "X-Octo-Source": "test", "Reply-To": "jeff@example.com" } });
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    const email = body.methodCalls[0][1].create.e;
    expect(email["header:X-Octo-Source:asRaw"]).toBe(" test");
    expect(email["header:Reply-To:asRaw"]).toBe(" jeff@example.com");
  });

  it("refuses bad headers before sending anything", async () => {
    const { cmdSend } = await import("../src/email.js");
    await expect(cmdSend(makeCfg(), { to: "r@example.com", subject: "S", body: "B", headers: { Bcc: "x@example.com" } })).rejects.toThrow(/can't be set/);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("custom headers with attachments", () => {
  it("writes them into the MIME message", async () => {
    const { mkdtempSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "fm-"));
    const file = join(dir, "note.txt");
    writeFileSync(file, "hello");
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ blobId: "b1" }) })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ methodResponses: [["Email/import", { created: { m: { id: "x" } } }, "import"], ["EmailSubmission/set", { created: { s: {} } }, "submit"]] }),
      });
    const { cmdSend } = await import("../src/email.js");
    await cmdSend(makeCfg(), { to: "r@example.com", subject: "S", body: "B", attachment: [file], headers: { "X-Octo-Source": "test" } });
    const mime = String(mockFetch.mock.calls[0][1].body);
    const head = mime.split("\r\n\r\n")[0];
    expect(head).toContain("\r\nX-Octo-Source: test\r\n");
    expect(head.indexOf("X-Octo-Source")).toBeLessThan(head.indexOf("MIME-Version"));
  });
});
