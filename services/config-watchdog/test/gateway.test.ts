import { describe, expect, it } from "vitest";
import { waitForStableHealth } from "../src/gateway.js";

describe("waitForStableHealth", () => {
  it("requires consecutive healthy checks before succeeding", async () => {
    let now = 0;
    const checks = [true, true, false, true, true, true];
    const seenSleeps: number[] = [];

    const ok = await waitForStableHealth(
      async () => checks.shift() ?? true,
      async (ms) => {
        seenSleeps.push(ms);
        now += ms;
      },
      () => now,
      3,
    );

    expect(ok).toBe(true);
    expect(seenSleeps.length).toBeGreaterThanOrEqual(5);
  });

  it("fails when health never stays stable long enough", async () => {
    let now = 0;
    const sleeps: number[] = [];
    const checks = [true, false, true, false, true, false, true, false];

    const ok = await waitForStableHealth(
      async () => checks.shift() ?? false,
      async (ms) => {
        sleeps.push(ms);
        now += ms;
      },
      () => now,
      3,
    );

    expect(ok).toBe(false);
    expect(sleeps.length).toBeGreaterThan(0);
  });
});
