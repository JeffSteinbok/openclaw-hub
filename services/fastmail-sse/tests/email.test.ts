/**
 * Tests for email body extraction.
 */

import { describe, it, expect } from "vitest";
import { getEmailBodyText, getEmailBodyHtml } from "../src/email.js";

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
