import { describe, it, expect } from "vitest";

import { validateAnalysis } from "../src/vision.js";

describe("validateAnalysis", () => {
  it("all fields present", () => {
    const analysis = {
      sender: "ACME",
      addressee: "Jeff",
      description: "Invoice",
      type: "scan",
      importance: "high",
      mail_class: "First-Class",
      address_method: "printed",
    };
    const result = validateAnalysis(analysis);
    expect(result.sender).toBe("ACME");
    expect(result.addressee).toBe("Jeff");
    expect(result.importance).toBe("high");
  });

  it("missing fields get defaults", () => {
    const result = validateAnalysis({ sender: "ACME" });
    expect(result.sender).toBe("ACME");
    expect(result.addressee).toBe("Unknown");
    expect(result.description).toBe("");
    expect(result.type).toBe("scan");
    expect(result.importance).toBe("medium");
    expect(result.mail_class).toBe("Unknown");
    expect(result.address_method).toBe("");
  });

  it("empty dict", () => {
    const result = validateAnalysis({});
    expect(result.sender).toBe("Unknown");
    expect(result.addressee).toBe("Unknown");
    expect(result.importance).toBe("medium");
    expect(result.type).toBe("scan");
  });

  it("extra fields not included", () => {
    const result = validateAnalysis({ sender: "X", extra_field: "should_be_gone" });
    expect((result as Record<string, unknown>).extra_field).toBeUndefined();
  });

  it("returns new object", () => {
    const original = { sender: "ACME", importance: "high" };
    const result = validateAnalysis(original);
    expect(result).not.toBe(original);
  });

  it("all default keys present", () => {
    const result = validateAnalysis({});
    const keys = new Set(Object.keys(result));
    const expected = new Set([
      "sender",
      "addressee",
      "description",
      "type",
      "importance",
      "mail_class",
      "address_method",
    ]);
    expect(keys).toEqual(expected);
  });
});
