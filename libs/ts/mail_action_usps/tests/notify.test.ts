import { describe, it, expect } from "vitest";

import {
  classifyRecipient,
  buildNotificationPlan,
} from "../src/notify.js";

describe("classifyRecipient", () => {
  it("jeff", () => expect(classifyRecipient("Jeff Steinbok")).toBe("jeff"));
  it("jeffrey", () => expect(classifyRecipient("Jeffrey Steinbok")).toBe("jeff"));
  it("nicole", () => expect(classifyRecipient("Nicole Smith")).toBe("nicole"));
  it("eastside improv", () => expect(classifyRecipient("Eastside Improv")).toBe("nicole"));
  it("joint jeffrey and nicole", () => expect(classifyRecipient("Jeffrey & Nicole Steinbok")).toBe("jeff"));
  it("joint jeff and nicole", () => expect(classifyRecipient("Jeff & Nicole")).toBe("jeff"));
  it("default unknown", () => expect(classifyRecipient("Current Resident")).toBe("jeff"));
  it("empty", () => expect(classifyRecipient("")).toBe("jeff"));
  it("null", () => expect(classifyRecipient(null)).toBe("jeff"));
  it("case insensitive", () => expect(classifyRecipient("NICOLE JONES")).toBe("nicole"));
});

function makeConfig() {
  return {
    routing: {
      jeff: { channel: "discord", target: "jeff-target" },
      nicole: { channel: "discord", target: "nicole-target" },
      default: { channel: "discord", target: "default-target" },
    },
  };
}

describe("buildNotificationPlan", () => {
  it("important items notified", () => {
    const items = [
      { sender: "IRS", addressee: "Jeff", importance: "urgent", description: "Tax notice" },
      { sender: "ACME", addressee: "Jeff", importance: "junk" },
    ];
    const plan = buildNotificationPlan("2024-01-15", items, { config: makeConfig() });
    expect(plan).toHaveLength(1);
    expect(plan[0].recipient).toBe("jeff");
    expect(plan[0].message).toContain("IRS");
    expect(plan[0].items).toHaveLength(1);
  });

  it("no important items → no plan", () => {
    const items = [
      { sender: "ACME", addressee: "Jeff", importance: "junk" },
      { sender: "Flyer", addressee: "Jeff", importance: "ad" },
    ];
    const plan = buildNotificationPlan("2024-01-15", items, { config: makeConfig() });
    expect(plan).toHaveLength(0);
  });

  it("nicole routing", () => {
    const items = [
      { sender: "Bank", addressee: "Nicole Smith", importance: "high", description: "Statement" },
    ];
    const plan = buildNotificationPlan("2024-01-15", items, { config: makeConfig() });
    expect(plan).toHaveLength(1);
    expect(plan[0].recipient).toBe("nicole");
    expect(plan[0].target).toBe("nicole-target");
  });

  it("junk summary for jeff", () => {
    const items = [
      { sender: "IRS", addressee: "Jeff", importance: "urgent" },
      { sender: "Junk Co", addressee: "Jeff", importance: "junk" },
      { sender: "Ad Co", addressee: "Jeff", importance: "ad" },
      { sender: "Routine", addressee: "Jeff", importance: "medium" },
    ];
    const plan = buildNotificationPlan("2024-01-15", items, { config: makeConfig() });
    const jeffPlan = plan.find((p) => p.recipient === "jeff")!;
    expect(jeffPlan.message).toContain("Also:");
    expect(jeffPlan.message).toContain("junk");
  });

  it("no junk summary for nicole", () => {
    const items = [
      { sender: "Bank", addressee: "Nicole", importance: "high" },
      { sender: "Junk", addressee: "Nicole", importance: "junk" },
    ];
    const plan = buildNotificationPlan("2024-01-15", items, { config: makeConfig() });
    const nicolePlans = plan.filter((p) => p.recipient === "nicole");
    if (nicolePlans.length > 0) {
      expect(nicolePlans[0].message).not.toContain("Also:");
    }
  });

  it("requires config or agent", () => {
    expect(() => buildNotificationPlan("2024-01-15", [])).toThrow();
  });

  it("multiple recipients", () => {
    const items = [
      { sender: "IRS", addressee: "Jeff", importance: "urgent" },
      { sender: "Bank", addressee: "Nicole", importance: "high" },
    ];
    const plan = buildNotificationPlan("2024-01-15", items, { config: makeConfig() });
    const recipients = new Set(plan.map((p) => p.recipient));
    expect(recipients).toEqual(new Set(["jeff", "nicole"]));
  });
});
