import { describe, it, expect } from "vitest";

import {
  classifyRecipient,
  buildNotificationPlan,
} from "../src/notify.js";

function makeRouting() {
  return {
    alice: { channel: "discord", target: "alice-target", addressee_patterns: ["alice"], summary: true },
    bob: { channel: "discord", target: "bob-target", addressee_patterns: ["bob", "acme studio"] },
    default: { channel: "discord", target: "default-target", summary: true },
  };
}

function makeConfig() {
  return { routing: makeRouting() };
}

describe("classifyRecipient", () => {
  const routing = makeRouting();
  it("matches a pattern", () => expect(classifyRecipient("Alice Example", routing)).toBe("alice"));
  it("matches any pattern for a route", () => expect(classifyRecipient("Acme Studio LLC", routing)).toBe("bob"));
  it("joint mail goes to the first matching route", () => expect(classifyRecipient("Alice & Bob Example", routing)).toBe("alice"));
  it("route order decides joint mail", () => {
    const { alice, bob, default: def } = routing;
    expect(classifyRecipient("Alice & Bob Example", { bob, alice, default: def })).toBe("bob");
  });
  it("unknown falls back to default", () => expect(classifyRecipient("Current Resident", routing)).toBe("default"));
  it("empty", () => expect(classifyRecipient("", routing)).toBe("default"));
  it("null", () => expect(classifyRecipient(null, routing)).toBe("default"));
  it("no routing", () => expect(classifyRecipient("Alice Example")).toBe("default"));
  it("case insensitive", () => expect(classifyRecipient("BOB JONES", routing)).toBe("bob"));
  it("ignores patterns on default", () => {
    expect(classifyRecipient("Alice", { default: { addressee_patterns: ["alice"] } })).toBe("default");
  });
});

describe("buildNotificationPlan", () => {
  it("important items notified", () => {
    const items = [
      { sender: "IRS", addressee: "Alice", importance: "urgent", description: "Tax notice" },
      { sender: "ACME", addressee: "Alice", importance: "junk" },
    ];
    const plan = buildNotificationPlan("2024-01-15", items, { config: makeConfig() });
    expect(plan).toHaveLength(1);
    expect(plan[0].recipient).toBe("alice");
    expect(plan[0].message).toContain("IRS");
    expect(plan[0].items).toHaveLength(1);
  });

  it("no important items → no plan", () => {
    const items = [
      { sender: "ACME", addressee: "Alice", importance: "junk" },
      { sender: "Flyer", addressee: "Alice", importance: "ad" },
    ];
    const plan = buildNotificationPlan("2024-01-15", items, { config: makeConfig() });
    expect(plan).toHaveLength(0);
  });

  it("pattern routing", () => {
    const items = [
      { sender: "Bank", addressee: "Bob Smith", importance: "high", description: "Statement" },
    ];
    const plan = buildNotificationPlan("2024-01-15", items, { config: makeConfig() });
    expect(plan).toHaveLength(1);
    expect(plan[0].recipient).toBe("bob");
    expect(plan[0].target).toBe("bob-target");
  });

  it("summary for routes that opt in", () => {
    const items = [
      { sender: "IRS", addressee: "Alice", importance: "urgent" },
      { sender: "Junk Co", addressee: "Alice", importance: "junk" },
      { sender: "Ad Co", addressee: "Alice", importance: "ad" },
      { sender: "Routine", addressee: "Alice", importance: "medium" },
    ];
    const plan = buildNotificationPlan("2024-01-15", items, { config: makeConfig() });
    const alicePlan = plan.find((p) => p.recipient === "alice")!;
    expect(alicePlan.message).toContain("Also:");
    expect(alicePlan.message).toContain("junk");
  });

  it("no summary for routes that do not opt in", () => {
    const items = [
      { sender: "Bank", addressee: "Bob", importance: "high" },
      { sender: "Junk", addressee: "Bob", importance: "junk" },
    ];
    const plan = buildNotificationPlan("2024-01-15", items, { config: makeConfig() });
    const bobPlan = plan.find((p) => p.recipient === "bob")!;
    expect(bobPlan.message).not.toContain("Also:");
  });

  it("unmatched addressee uses default route", () => {
    const items = [{ sender: "IRS", addressee: "Current Resident", importance: "high" }];
    const plan = buildNotificationPlan("2024-01-15", items, { config: makeConfig() });
    expect(plan).toHaveLength(1);
    expect(plan[0].recipient).toBe("default");
    expect(plan[0].target).toBe("default-target");
  });

  it("requires config or agent", () => {
    expect(() => buildNotificationPlan("2024-01-15", [])).toThrow();
  });

  it("multiple recipients", () => {
    const items = [
      { sender: "IRS", addressee: "Alice", importance: "urgent" },
      { sender: "Bank", addressee: "Bob", importance: "high" },
    ];
    const plan = buildNotificationPlan("2024-01-15", items, { config: makeConfig() });
    const recipients = new Set(plan.map((p) => p.recipient));
    expect(recipients).toEqual(new Set(["alice", "bob"]));
  });
});
