/**
 * Tests for email body extraction.
 */

import { describe, it, expect } from "vitest";
import { getEmailBodyText, getEmailBodyHtml, parseAuthResults } from "../src/email.js";

describe("TestGetEmailBodyText", () => {
  it("should extract text from textBody parts", () => {
    const email = {
      textBody: [{ partId: "1" }],
      bodyValues: { "1": { value: "Email body text" } },
    };
    expect(getEmailBodyText(email)).toBe("Email body text");
  });

  it("should extract from first textBody part when multiple exist", () => {
    const email = {
      textBody: [{ partId: "1" }, { partId: "2" }],
      bodyValues: {
        "1": { value: "First part" },
        "2": { value: "Second part" },
      },
    };
    expect(getEmailBodyText(email)).toBe("First part");
  });

  it("should fallback to any bodyValue when textBody is empty", () => {
    const email = {
      textBody: [],
      bodyValues: { "3": { value: "Some body text" } },
    };
    expect(getEmailBodyText(email)).toBe("Some body text");
  });

  it("should return empty string when no bodyValues", () => {
    const email = { textBody: [], bodyValues: {} };
    expect(getEmailBodyText(email)).toBe("");
  });

  it("should return empty string when bodyValues key missing", () => {
    const email = { textBody: [{ partId: "1" }] };
    expect(getEmailBodyText(email)).toBe("");
  });

  it("should fallback when textBody partId not in bodyValues", () => {
    const email = {
      textBody: [{ partId: "99" }],
      bodyValues: { "1": { value: "Available body" } },
    };
    expect(getEmailBodyText(email)).toBe("Available body");
  });
});

describe("TestGetEmailBodyHtml", () => {
  it("should extract HTML from htmlBody parts", () => {
    const email = {
      htmlBody: [{ partId: "2" }],
      bodyValues: { "2": { value: "<html><body>Hello</body></html>" } },
    };
    expect(getEmailBodyHtml(email)).toBe("<html><body>Hello</body></html>");
  });

  it("should return empty string when htmlBody is absent", () => {
    const email = { htmlBody: [], bodyValues: {} };
    expect(getEmailBodyHtml(email)).toBe("");
  });

  it("should return empty string when htmlBody key is missing", () => {
    const email = {};
    expect(getEmailBodyHtml(email)).toBe("");
  });

  it("should return empty string when partId is not found in bodyValues", () => {
    const email = {
      htmlBody: [{ partId: "99" }],
      bodyValues: { "1": { value: "other part" } },
    };
    expect(getEmailBodyHtml(email)).toBe("");
  });
});

describe("TestParseAuthResults", () => {
  it("should parse all three results from a typical header", () => {
    const raw =
      "mx.fastmail.com;\n dkim=pass header.i=@example.com;\n spf=pass smtp.mailfrom=example.com;\n dmarc=pass";
    const result = parseAuthResults(raw);
    expect(result?.dkim).toBe("pass");
    expect(result?.spf).toBe("pass");
    expect(result?.dmarc).toBe("pass");
    expect(result?.raw).toBe(raw.trim());
  });

  it("should handle fail results", () => {
    const raw = "mx.example.com;\n dkim=fail;\n spf=fail;\n dmarc=fail";
    const result = parseAuthResults(raw);
    expect(result?.dkim).toBe("fail");
    expect(result?.spf).toBe("fail");
    expect(result?.dmarc).toBe("fail");
  });

  it("should return undefined when no recognisable results", () => {
    expect(parseAuthResults("mx.example.com; none")).toBeUndefined();
    expect(parseAuthResults("")).toBeUndefined();
    expect(parseAuthResults(null)).toBeUndefined();
    expect(parseAuthResults(undefined)).toBeUndefined();
  });

  it("should be case-insensitive", () => {
    const raw = "mx.example.com;\n DKIM=Pass;\n SPF=PASS";
    const result = parseAuthResults(raw);
    expect(result?.dkim).toBe("pass");
    expect(result?.spf).toBe("pass");
  });

  it("should populate auth_results on envelope via emailToEnvelope", async () => {
    const { emailToEnvelope } = await import("../src/email.js");
    const email = {
      id: "msg1",
      from: [{ name: "Test", email: "test@example.com" }],
      subject: "Hello",
      receivedAt: "2024-01-01T00:00:00Z",
      "header:Authentication-Results:asText":
        "mx.fastmail.com;\n dkim=pass;\n spf=pass;\n dmarc=pass",
    };
    const envelope = emailToEnvelope(email, "acct1");
    expect(envelope.auth_results?.dkim).toBe("pass");
    expect(envelope.auth_results?.spf).toBe("pass");
    expect(envelope.auth_results?.dmarc).toBe("pass");
  });
});
