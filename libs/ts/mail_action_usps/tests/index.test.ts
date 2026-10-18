import { describe, expect, it } from "vitest";
import * as plugin from "../src/index.js";

describe("ActionPlugin entry point", () => {
  it("registers process_usps_digest through register()", () => {
    const names: string[] = [];
    plugin.register({ register: (name: string) => names.push(name) } as never);
    expect(names).toEqual(["process_usps_digest"]);
  });
});
