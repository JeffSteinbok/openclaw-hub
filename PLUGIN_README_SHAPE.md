# Plugin README Shape

Use this structure for plugin READMEs in `openclaw-hub`.

## Required sections

1. `# Plugin Name`
2. Short summary paragraph
3. `## Tools`
4. `## Configuration Schema` when the plugin has `configSchema`
5. `## Example config` when the plugin has runtime config
6. `## Environment Variables` when the manifest declares env vars or the example config uses `${...}`
7. `## Tool Parameters`

## Recommended sections

- `## CLI Usage`
- `## Notes`
- `## Plugin Structure`
- setup or auth sections when the plugin needs extra operational steps

## Section details

### CLI Usage

- Show how to build and run the plugin as a standalone CLI
- Include example commands for each tool/subcommand
- List environment variables needed for CLI mode (if plugin has configSchema)

Example:

```md
## CLI Usage

All tools are also available as a standalone CLI:

\`\`\`bash
cd plugins/my-plugin
npm install && npm run build
node dist/bin/my-plugin.js --help
node dist/bin/my-plugin.js my-tool <arg>
node dist/bin/my-plugin.js my-tool <arg> --json
\`\`\`

### CLI Environment Variables

| Variable | Description |
|----------|-------------|
| `MY_PLUGIN_API_KEY` | API key for the service |
```

### Tools

- Start with a markdown table: `Tool | Description`
- Link each tool name to its detailed section below
- Use stable in-page anchors for each tool section

Example:

```md
## Tools

| Tool | Description |
|------|-------------|
| [`my_tool`](#tool-my_tool) | Short description |
```

### Configuration Schema

- Document the schema in human-readable form, even if it also exists in `openclaw.plugin.json`
- Use a table: `Field | Type | Required | Description`
- Flatten nested objects/arrays with paths like `items[].id`

### Example config

- Show a copy-paste JSON example under `plugins.entries["<plugin-id>"].config`
- Prefer generic sample values
- Use `${ENV_VAR}` interpolation when that is the intended pattern

### Environment Variables

- Keep the table aligned with the manifest/readme docs flow
- Use: `Variable | Required | Description`
- If env vars are declared in the manifest, they must be listed here

### Tool Parameters

- Add one subsection per tool
- Include an anchor before each tool subsection to match the links in `## Tools`
- Describe parameters in bullets or a table

Example:

```md
## Tool Parameters

<a id="tool-my_tool"></a>

### `my_tool`

- `id` — stable identifier
- `limit` — optional max results
```

## Style rules

- Keep examples generic and reusable
- Do not use personal names or live private values in sample config
- Match README docs whenever `configSchema` or manifest env vars change
- Prefer concise operator-facing language over implementation detail
