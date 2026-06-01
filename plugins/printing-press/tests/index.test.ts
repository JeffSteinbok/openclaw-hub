/**
 * Tests for the Printing Press adapter plugin.
 *
 * Tests manifest parsing, tool resolution, argument building, security
 * validation, and plugin registration.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync, writeFileSync, rmSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TEST_ROOT = join(tmpdir(), `pp-test-${Date.now()}`);

beforeAll(() => {
  mkdirSync(TEST_ROOT, { recursive: true });
});

afterAll(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Manifest tests
// ---------------------------------------------------------------------------

describe("manifest", () => {
  it("loads a valid tools-manifest.json", async () => {
    const { loadToolsManifest } = await import("../src/manifest.js");
    const manifestPath = join(TEST_ROOT, "valid-manifest.json");
    writeFileSync(manifestPath, JSON.stringify({
      api_name: "test-api",
      base_url: "https://api.test.com",
      description: "Test API",
      mcp_ready: "full",
      auth: { type: "api_key", env_vars: ["TEST_API_KEY"] },
      tools: [
        {
          name: "users_list",
          description: "List users",
          method: "GET",
          path: "/v1/users",
          params: [
            { name: "limit", type: "integer", location: "query" },
          ],
        },
        {
          name: "users_create",
          description: "Create user",
          method: "POST",
          path: "/v1/users",
          params: [
            { name: "name", type: "string", location: "body", required: true },
            { name: "email", type: "string", location: "body", required: true },
          ],
        },
        {
          name: "users_delete",
          description: "Delete a user",
          method: "DELETE",
          path: "/v1/users/{id}",
          params: [
            { name: "id", type: "string", location: "path", required: true },
          ],
        },
      ],
    }));

    const manifest = loadToolsManifest(manifestPath);
    expect(manifest.api_name).toBe("test-api");
    expect(manifest.tools).toHaveLength(3);
  });

  it("rejects invalid manifest", async () => {
    const { loadToolsManifest } = await import("../src/manifest.js");
    const manifestPath = join(TEST_ROOT, "invalid-manifest.json");
    writeFileSync(manifestPath, JSON.stringify({ foo: "bar" }));

    expect(() => loadToolsManifest(manifestPath)).toThrow(/missing api_name/);
  });

  it("converts tool names correctly", async () => {
    const { toToolName } = await import("../src/manifest.js");
    expect(toToolName("linear", "issues_list")).toBe("pp_linear_issues_list");
    expect(toToolName("elevenlabs", "audio-isolation_create")).toBe("pp_elevenlabs_audio_isolation_create");
  });

  it("converts to subcommand path", async () => {
    const { toSubcommand } = await import("../src/manifest.js");
    expect(toSubcommand("users_list")).toEqual(["users", "list"]);
    // Underscores are level separators; hyphens preserved within levels
    expect(toSubcommand("audio-isolation_audio_isolation")).toEqual(["audio-isolation", "audio", "isolation"]);
    expect(toSubcommand("registrar_domain-search")).toEqual(["registrar", "domain-search"]);
    expect(toSubcommand("audio-native_content_audio-native-project-update-endpoint"))
      .toEqual(["audio-native", "content", "audio-native-project-update-endpoint"]);
  });
});

// ---------------------------------------------------------------------------
// Tool resolution tests
// ---------------------------------------------------------------------------

describe("tool resolution", () => {
  function makeManifest() {
    return {
      api_name: "test",
      base_url: "https://test.com",
      description: "Test",
      mcp_ready: "full",
      auth: { type: "api_key" },
      tools: [
        { name: "items_list", description: "List items", method: "GET", path: "/items", params: [] },
        { name: "items_get", description: "Get item", method: "GET", path: "/items/{id}", params: [] },
        { name: "items_create", description: "Create item", method: "POST", path: "/items", params: [] },
        { name: "items_update", description: "Update item", method: "PUT", path: "/items/{id}", params: [] },
        { name: "items_delete", description: "Delete item", method: "DELETE", path: "/items/{id}", params: [] },
      ],
    };
  }

  it("blocks DELETE, PUT, PATCH by default", async () => {
    const { resolveTools } = await import("../src/manifest.js");
    const tools = resolveTools(makeManifest(), {
      name: "test",
      binaryPath: "/usr/bin/test",
      manifestPath: "/tmp/m.json",
    });

    const names = tools.map((t) => t.toolName);
    expect(names).toContain("pp_test_items_list");
    expect(names).toContain("pp_test_items_get");
    expect(names).toContain("pp_test_items_create");
    expect(names).not.toContain("pp_test_items_update");
    expect(names).not.toContain("pp_test_items_delete");
  });

  it("respects allowedTools whitelist", async () => {
    const { resolveTools } = await import("../src/manifest.js");
    const tools = resolveTools(makeManifest(), {
      name: "test",
      binaryPath: "/usr/bin/test",
      manifestPath: "/tmp/m.json",
      allowedTools: ["items_list", "items_delete"],
    });

    const names = tools.map((t) => t.toolName);
    expect(names).toEqual(["pp_test_items_list", "pp_test_items_delete"]);
  });

  it("enforces maxTools cap", async () => {
    const { resolveTools } = await import("../src/manifest.js");
    const tools = resolveTools(makeManifest(), {
      name: "test",
      binaryPath: "/usr/bin/test",
      manifestPath: "/tmp/m.json",
      maxTools: 2,
    });

    expect(tools).toHaveLength(2);
  });

  it("allowedTools overrides blockedMethods", async () => {
    const { resolveTools } = await import("../src/manifest.js");
    const tools = resolveTools(makeManifest(), {
      name: "test",
      binaryPath: "/usr/bin/test",
      manifestPath: "/tmp/m.json",
      allowedTools: ["items_delete"],
    });

    // DELETE is normally blocked, but allowedTools overrides
    expect(tools).toHaveLength(1);
    expect(tools[0].toolName).toBe("pp_test_items_delete");
  });
});

// ---------------------------------------------------------------------------
// Argument building tests
// ---------------------------------------------------------------------------

describe("argument building", () => {
  it("builds flags from params", async () => {
    const { buildArgs } = await import("../src/executor.js");
    const args = buildArgs(
      ["users", "list"],
      { limit: 10, active: true },
      [
        { name: "limit", type: "integer", location: "query" },
        { name: "active", type: "boolean", location: "query" },
      ],
    );

    expect(args).toContain("users");
    expect(args).toContain("list");
    expect(args).toContain("--json");
    expect(args).toContain("--compact");
    expect(args).toContain("--quiet");
    expect(args).toContain("--limit=10");
    expect(args).toContain("--active");
  });

  it("skips null/undefined params", async () => {
    const { buildArgs } = await import("../src/executor.js");
    const args = buildArgs(
      ["test"],
      { name: "foo", email: null, phone: undefined },
      [
        { name: "name", type: "string", location: "body" },
        { name: "email", type: "string", location: "body" },
        { name: "phone", type: "string", location: "body" },
      ],
    );

    expect(args).toContain("--name=foo");
    expect(args.some((a) => a.includes("email"))).toBe(false);
    expect(args.some((a) => a.includes("phone"))).toBe(false);
  });

  it("rejects params not in manifest", async () => {
    const { buildArgs } = await import("../src/executor.js");
    const args = buildArgs(
      ["test"],
      { name: "foo", injected: "evil" },
      [{ name: "name", type: "string", location: "body" }],
    );

    expect(args).toContain("--name=foo");
    expect(args.some((a) => a.includes("injected"))).toBe(false);
  });

  it("handles array params as repeated flags", async () => {
    const { buildArgs } = await import("../src/executor.js");
    const args = buildArgs(
      ["test"],
      { tags: ["a", "b", "c"] },
      [{ name: "tags", type: "array", location: "body" }],
    );

    expect(args).toContain("--tags=a");
    expect(args).toContain("--tags=b");
    expect(args).toContain("--tags=c");
  });

  it("converts underscores to hyphens in flag names", async () => {
    const { buildArgs } = await import("../src/executor.js");
    const args = buildArgs(
      ["test"],
      { file_format: "mp3" },
      [{ name: "file_format", type: "string", location: "body" }],
    );

    expect(args).toContain("--file-format=mp3");
  });
});

// ---------------------------------------------------------------------------
// Security tests
// ---------------------------------------------------------------------------

describe("security", () => {
  it("rejects relative binary path", async () => {
    const { validateBinaryPath } = await import("../src/security.js");
    expect(() => validateBinaryPath("./bin/test")).toThrow(/absolute/);
  });

  it("rejects nonexistent binary", async () => {
    const { validateBinaryPath } = await import("../src/security.js");
    expect(() => validateBinaryPath("/usr/bin/nonexistent-pp-cli-12345")).toThrow(/not found/);
  });

  it("accepts valid executable", async () => {
    const { validateBinaryPath } = await import("../src/security.js");
    // /usr/bin/true should exist on any Linux system
    expect(() => validateBinaryPath("/usr/bin/true")).not.toThrow();
  });

  it("builds scoped environment", async () => {
    const { buildSafeEnv } = await import("../src/security.js");
    const env = buildSafeEnv({ API_KEY: "secret123" });

    expect(env.PATH).toBeDefined();
    expect(env.NO_COLOR).toBe("1");
    expect(env.API_KEY).toBe("secret123");
    // Should NOT have inherited random process env vars
    expect(env.npm_lifecycle_event).toBeUndefined();
  });

  it("resolves ${VAR} references in env", async () => {
    const { buildSafeEnv } = await import("../src/security.js");
    process.env.__PP_TEST_VAR = "resolved_value";
    const env = buildSafeEnv({ MY_KEY: "${__PP_TEST_VAR}" });
    expect(env.MY_KEY).toBe("resolved_value");
    delete process.env.__PP_TEST_VAR;
  });
});

// ---------------------------------------------------------------------------
// Plugin entry tests
// ---------------------------------------------------------------------------

describe("plugin entry", () => {
  it("has correct id and name", async () => {
    const { createEntry } = await import("../src/index.js");
    const entry = createEntry();
    expect(entry.id).toBe("printing-press");
    expect(entry.name).toBe("Printing Press");
  });

  it("throws when no CLIs configured", async () => {
    const { createEntry } = await import("../src/index.js");
    const entry = createEntry();
    expect(() => entry.register({
      pluginConfig: {},
      registerTool: () => {},
    })).toThrow(/at least one CLI/);
  });

  it("registers tools from a valid manifest", async () => {
    const { createEntry } = await import("../src/index.js");

    // Create a fake binary (just needs to exist and be executable)
    const fakeBin = join(TEST_ROOT, "fake-pp-cli");
    writeFileSync(fakeBin, "#!/bin/sh\necho '{}'");
    chmodSync(fakeBin, 0o755);

    // Create manifest
    const manifestPath = join(TEST_ROOT, "reg-test-manifest.json");
    writeFileSync(manifestPath, JSON.stringify({
      api_name: "testapi",
      base_url: "https://test.com",
      description: "Test",
      mcp_ready: "full",
      auth: { type: "api_key" },
      tools: [
        { name: "items_list", description: "List items", method: "GET", path: "/items", params: [] },
        { name: "items_get", description: "Get item", method: "GET", path: "/items/{id}", params: [] },
      ],
    }));

    const entry = createEntry();
    const tools: Record<string, unknown> = {};
    entry.register({
      pluginConfig: {
        clis: [{
          name: "testapi",
          binaryPath: fakeBin,
          manifestPath,
        }],
      },
      registerTool: (tool: { name: string }) => { tools[tool.name] = tool; },
    });

    expect(tools["pp_testapi_items_list"]).toBeDefined();
    expect(tools["pp_testapi_items_get"]).toBeDefined();
    // Meta-tool should also be registered
    expect(tools["pp_list_tools"]).toBeDefined();
  });

  it("continues loading other CLIs when one fails", async () => {
    const { createEntry } = await import("../src/index.js");

    const fakeBin = join(TEST_ROOT, "fake-pp-cli-2");
    writeFileSync(fakeBin, "#!/bin/sh\necho '{}'");
    chmodSync(fakeBin, 0o755);

    const manifestPath = join(TEST_ROOT, "reg-test-manifest-2.json");
    writeFileSync(manifestPath, JSON.stringify({
      api_name: "goodcli",
      base_url: "https://test.com",
      description: "Test",
      mcp_ready: "full",
      auth: { type: "api_key" },
      tools: [
        { name: "ok_tool", description: "Works", method: "GET", path: "/ok", params: [] },
      ],
    }));

    const entry = createEntry();
    const tools: Record<string, unknown> = {};
    entry.register({
      pluginConfig: {
        clis: [
          { name: "broken", binaryPath: "/nonexistent/binary", manifestPath: "/nonexistent/manifest.json" },
          { name: "good", binaryPath: fakeBin, manifestPath },
        ],
      },
      registerTool: (tool: { name: string }) => { tools[tool.name] = tool; },
    });

    // Broken CLI should not prevent good CLI from registering
    expect(tools["pp_good_ok_tool"]).toBeDefined();
    expect(tools["pp_list_tools"]).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Executor integration test
// ---------------------------------------------------------------------------

describe("executor", () => {
  it("executes a simple binary and captures output", async () => {
    const { executeCli } = await import("../src/executor.js");

    // Use /bin/echo to produce JSON output
    const result = await executeCli({
      binaryPath: "/bin/echo",
      subcommand: [],
      params: {},
      paramDefs: [],
      timeout: 5000,
    });

    // echo will output the flags as text, which won't parse as JSON
    expect(result.exitCode).toBe(0);
  });

  it("handles timeout", async () => {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const { writeFileSync, chmodSync } = await import("node:fs");
    const { join } = await import("node:path");

    // Create a script that sleeps and ignores unknown flags
    const sleepScript = join(TEST_ROOT, "slow-cli.sh");
    writeFileSync(sleepScript, "#!/bin/sh\nsleep 60\n");
    chmodSync(sleepScript, 0o755);

    const { executeCli } = await import("../src/executor.js");

    const result = await executeCli({
      binaryPath: sleepScript,
      subcommand: [],
      params: {},
      paramDefs: [],
      timeout: 200,
    });

    expect(result.output).toMatchObject({ error: expect.stringContaining("timed out") });
  });
});
