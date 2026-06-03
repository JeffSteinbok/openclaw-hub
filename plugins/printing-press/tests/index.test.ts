/**
 * Tests for the Printing Press adapter plugin.
 *
 * Tests manifest parsing, CLI introspection, tool resolution, argument
 * building, security validation, and plugin registration.
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

  it("uses wire_name when available", async () => {
    const { buildArgs } = await import("../src/executor.js");
    const args = buildArgs(
      ["forecast"],
      { forecast_days: 3 },
      [{ name: "forecast_days", wire_name: "forecast-days", type: "integer", location: "flag" }],
    );

    expect(args).toContain("--forecast-days=3");
  });

  it("places positional args before flags", async () => {
    const { buildArgs } = await import("../src/executor.js");
    const args = buildArgs(
      ["geocoding"],
      { name: "Seattle", count: 5 },
      [
        { name: "name", type: "string", location: "positional" },
        { name: "count", type: "integer", location: "flag" },
      ],
    );

    const nameIdx = args.indexOf("Seattle");
    const countIdx = args.indexOf("--count=5");
    expect(nameIdx).toBeGreaterThan(-1);
    expect(countIdx).toBeGreaterThan(-1);
    expect(nameIdx).toBeLessThan(countIdx);
    // Positional should come right after subcommand
    expect(args[0]).toBe("geocoding");
    expect(args[1]).toBe("Seattle");
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
    expect(tools["pp_list_tools"]).toBeDefined();
  });

  it("accepts config without manifestPath", async () => {
    const { createEntry } = await import("../src/index.js");

    // Create a fake binary that responds to __complete
    const fakeBin = join(TEST_ROOT, "fake-introspect-cli");
    writeFileSync(fakeBin, `#!/bin/sh
if [ "$1" = "__complete" ]; then
  echo ":4"
  echo "Completion ended with directive: ShellCompDirectiveNoFileComp"
  exit 0
fi
echo '{}'
`);
    chmodSync(fakeBin, 0o755);

    const entry = createEntry();
    const tools: Record<string, unknown> = {};

    // Should not throw — introspection mode (no manifest)
    expect(() => entry.register({
      pluginConfig: {
        clis: [{ name: "goat", binaryPath: fakeBin }],
      },
      registerTool: (tool: { name: string }) => { tools[tool.name] = tool; },
    })).not.toThrow();

    // pp_list_tools always registered
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

// ---------------------------------------------------------------------------
// Introspection parser tests
// ---------------------------------------------------------------------------

describe("introspection: parseCompleteOutput", () => {
  it("parses tab-separated command entries", async () => {
    const { parseCompleteOutput } = await import("../src/introspect.js");
    const output = [
      "forecast\tGet current weather conditions and today's forecast",
      "alerts\tView active NWS weather alerts",
      "geocoding\tSearch for a location by name",
      ":4",
      "Completion ended with directive: ShellCompDirectiveNoFileComp",
    ].join("\n");

    const entries = parseCompleteOutput(output);
    expect(entries).toHaveLength(3);
    expect(entries[0]).toEqual({ name: "forecast", description: "Get current weather conditions and today's forecast" });
    expect(entries[2]).toEqual({ name: "geocoding", description: "Search for a location by name" });
  });

  it("skips directive and empty lines", async () => {
    const { parseCompleteOutput } = await import("../src/introspect.js");
    const output = ":4\nCompletion ended with directive: ShellCompDirectiveNoFileComp\n";
    expect(parseCompleteOutput(output)).toHaveLength(0);
  });

  it("handles entries without descriptions", async () => {
    const { parseCompleteOutput } = await import("../src/introspect.js");
    const output = "forecast\n:4\n";
    const entries = parseCompleteOutput(output);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({ name: "forecast", description: "" });
  });

  it("parses flag entries from __complete", async () => {
    const { parseCompleteOutput } = await import("../src/introspect.js");
    const output = [
      "--latitude\tLatitude (-90 to 90)",
      "--longitude\tLongitude (-180 to 180)",
      "--forecast-days\tNumber of forecast days (1-16)",
      ":4",
    ].join("\n");

    const entries = parseCompleteOutput(output);
    expect(entries).toHaveLength(3);
    expect(entries[0].name).toBe("--latitude");
  });
});

describe("introspection: parseHelpFlags", () => {
  it("parses typed flags from --help output", async () => {
    const { parseHelpFlags } = await import("../src/introspect.js");
    const helpOutput = `Get current weather conditions

Usage:
  weather-goat forecast [flags]

Flags:
      --latitude float    Latitude (-90 to 90)
      --longitude float   Longitude (-180 to 180)
      --forecast-days int         Number of forecast days (1-16) (default 7)
      --temperature-unit string   Temperature unit: celsius or fahrenheit (default "fahrenheit")
  -h, --help              help for forecast

Global Flags:
      --agent                Set all agent-friendly defaults
      --json                 Output as JSON
`;

    const flags = parseHelpFlags(helpOutput);
    expect(flags.length).toBeGreaterThanOrEqual(3);

    const lat = flags.find((f) => f.longName === "latitude");
    expect(lat).toBeDefined();
    expect(lat!.type).toBe("float");

    const days = flags.find((f) => f.longName === "forecast-days");
    expect(days).toBeDefined();
    expect(days!.type).toBe("int");
    expect(days!.defaultValue).toBe("7");

    const unit = flags.find((f) => f.longName === "temperature-unit");
    expect(unit).toBeDefined();
    expect(unit!.type).toBe("string");
    expect(unit!.defaultValue).toBe("fahrenheit");

    // Global flags should be excluded
    const agent = flags.find((f) => f.longName === "agent");
    expect(agent).toBeUndefined();

    const json = flags.find((f) => f.longName === "json");
    expect(json).toBeUndefined();

    // help is in GLOBAL_FLAGS set, so excluded
    const help = flags.find((f) => f.longName === "help");
    expect(help).toBeUndefined();
  });

  it("treats flags without type annotation as boolean", async () => {
    const { parseHelpFlags } = await import("../src/introspect.js");
    const helpOutput = `Flags:
      --verbose   Enable verbose output
      --dry-run   Show request without sending
`;
    const flags = parseHelpFlags(helpOutput);
    const verbose = flags.find((f) => f.longName === "verbose");
    expect(verbose).toBeDefined();
    expect(verbose!.type).toBe("bool");

    // dry-run is a global flag, should be excluded
    const dryRun = flags.find((f) => f.longName === "dry-run");
    expect(dryRun).toBeUndefined();
  });

  it("parses short+long flag aliases", async () => {
    const { parseHelpFlags } = await import("../src/introspect.js");
    const helpOutput = `Flags:
  -n, --count int         Number of results (default 5)
  -l, --language string   Language for results (default "en")
`;
    const flags = parseHelpFlags(helpOutput);
    expect(flags).toHaveLength(2);
    expect(flags[0].longName).toBe("count");
    expect(flags[0].type).toBe("int");
    expect(flags[1].longName).toBe("language");
  });
});

describe("introspection: parsePositionals", () => {
  it("parses required positional args", async () => {
    const { parsePositionals } = await import("../src/introspect.js");
    const helpOutput = `Compare weather

Usage:
  weather-goat compare <location1> <location2> [flags]

Flags:
`;
    const positionals = parsePositionals(helpOutput);
    expect(positionals).toHaveLength(2);
    expect(positionals[0]).toEqual({ name: "location1", required: true });
    expect(positionals[1]).toEqual({ name: "location2", required: true });
  });

  it("parses optional positional args", async () => {
    const { parsePositionals } = await import("../src/introspect.js");
    const helpOutput = `View alerts

Usage:
  weather-goat alerts [location] [flags]

Flags:
`;
    const positionals = parsePositionals(helpOutput);
    expect(positionals).toHaveLength(1);
    expect(positionals[0]).toEqual({ name: "location", required: false });
  });

  it("parses mixed required and optional args", async () => {
    const { parsePositionals } = await import("../src/introspect.js");
    const helpOutput = `Search

Usage:
  cli search <query> [limit] [flags]

Flags:
`;
    const positionals = parsePositionals(helpOutput);
    expect(positionals).toHaveLength(2);
    expect(positionals[0]).toEqual({ name: "query", required: true });
    expect(positionals[1]).toEqual({ name: "limit", required: false });
  });

  it("returns empty for commands with no positionals", async () => {
    const { parsePositionals } = await import("../src/introspect.js");
    const helpOutput = `Get forecast

Usage:
  weather-goat forecast [flags]

Flags:
`;
    const positionals = parsePositionals(helpOutput);
    expect(positionals).toHaveLength(0);
  });
});

describe("introspection: integration with fake CLI", () => {
  it("discovers commands from a fake Cobra CLI", async () => {
    const { introspectCli } = await import("../src/introspect.js");

    // Create a fake CLI that mimics Cobra __complete and --help
    const fakeBin = join(TEST_ROOT, "fake-cobra-cli");
    writeFileSync(fakeBin, `#!/bin/sh
case "$*" in
  "__complete ")
    echo "forecast	Get weather forecast"
    echo "geocoding	Search for a location"
    echo "help	Help about any command"
    echo "version	Print version"
    echo "completion	Generate completion scripts"
    echo "config	Manage configuration"
    echo ":4"
    echo "Completion ended with directive: ShellCompDirectiveNoFileComp"
    ;;
  "__complete forecast ")
    echo ":4"
    echo "Completion ended with directive: ShellCompDirectiveNoFileComp"
    ;;
  "__complete geocoding ")
    echo ":4"
    echo "Completion ended with directive: ShellCompDirectiveNoFileComp"
    ;;
  "forecast --help")
    echo "Get weather forecast"
    echo ""
    echo "Usage:"
    echo "  fake-cobra-cli forecast [flags]"
    echo ""
    echo "Flags:"
    echo "      --latitude float    Latitude (-90 to 90)"
    echo "      --longitude float   Longitude (-180 to 180)"
    echo "  -h, --help              help for forecast"
    echo ""
    echo "Global Flags:"
    echo "      --json   Output as JSON"
    ;;
  "geocoding --help")
    echo "Search for a location"
    echo ""
    echo "Usage:"
    echo "  fake-cobra-cli geocoding <name> [flags]"
    echo ""
    echo "Flags:"
    echo "      --count int         Number of results (default 5)"
    echo "  -h, --help              help for geocoding"
    echo ""
    echo "Global Flags:"
    echo "      --json   Output as JSON"
    ;;
  *)
    echo '{}'
    ;;
esac
`);
    chmodSync(fakeBin, 0o755);

    const tools = introspectCli({
      name: "weather",
      binaryPath: fakeBin,
    });

    // Should discover forecast and geocoding, skip help/version/completion/config
    expect(tools.length).toBe(2);

    const forecast = tools.find((t) => t.toolName === "pp_weather_forecast");
    expect(forecast).toBeDefined();
    expect(forecast!.subcommand).toEqual(["forecast"]);
    expect(forecast!.ppTool.params.length).toBe(2); // latitude, longitude (help excluded)
    expect(forecast!.ppTool.params[0].name).toBe("latitude");
    expect(forecast!.ppTool.params[0].type).toBe("number"); // float → number

    const geocoding = tools.find((t) => t.toolName === "pp_weather_geocoding");
    expect(geocoding).toBeDefined();
    // Should have positional arg + flag
    const posParams = geocoding!.ppTool.params.filter((p) => p.location === "positional");
    expect(posParams).toHaveLength(1);
    expect(posParams[0].name).toBe("name");
    expect(posParams[0].required).toBe(true);

    const flagParams = geocoding!.ppTool.params.filter((p) => p.location === "flag");
    expect(flagParams).toHaveLength(1);
    expect(flagParams[0].name).toBe("count");
  });

  it("respects allowedTools filter in introspection mode", async () => {
    const { introspectCli } = await import("../src/introspect.js");

    const fakeBin = join(TEST_ROOT, "fake-cobra-cli"); // reuse from above

    const tools = introspectCli({
      name: "weather",
      binaryPath: fakeBin,
      allowedTools: ["forecast"],
    });

    expect(tools.length).toBe(1);
    expect(tools[0].toolName).toBe("pp_weather_forecast");
  });

  it("respects maxTools cap", async () => {
    const { introspectCli } = await import("../src/introspect.js");

    const fakeBin = join(TEST_ROOT, "fake-cobra-cli"); // reuse from above

    const tools = introspectCli({
      name: "weather",
      binaryPath: fakeBin,
      maxTools: 1,
    });

    expect(tools.length).toBe(1);
  });
});
