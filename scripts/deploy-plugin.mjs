#!/usr/bin/env node
/**
 * Build and pack OpenClaw plugins for a managed install.
 *
 * Usage:
 *   node scripts/deploy-plugin.mjs <id> [<id>...] [--install]
 *   node scripts/deploy-plugin.mjs --all [--install]
 *
 * For each plugin under plugins/<id>: builds it (and any workspace libraries
 * it depends on), runs `npm pack` into out/plugin-packs/<id>.tgz, checks the
 * tarball contents, and prints the `openclaw plugins install` command.
 * With --install, runs that command too.
 *
 * The pack is a plain npm tarball shaped by each package.json "files" field.
 * OpenClaw installs it (npm-pack:<path>) into its own managed plugin root with
 * production dependencies only, so dev node_modules never reach the gateway.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginsDir = path.join(repoRoot, "plugins");
const outDir = path.join(repoRoot, "out", "plugin-packs");

/** Paths that must never ship in a pack. */
const FORBIDDEN = [/^package\/node_modules\//, /^package\/src\//, /^package\/tests?\//];

function usage(code) {
  const out = code === 0 ? console.log : console.error;
  out("Usage: node scripts/deploy-plugin.mjs <id> [<id>...] | --all [--install]");
  process.exit(code);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function run(cmd, args, cwd, { capture = false } = {}) {
  const result = spawnSync(cmd, args, {
    cwd,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed (exit ${result.status}) in ${path.relative(repoRoot, cwd) || "."}`);
  }
  return result.stdout;
}

function listPlugins() {
  return fs
    .readdirSync(pluginsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(pluginsDir, d.name, "package.json")))
    .map((d) => d.name)
    .sort();
}

/** Map workspace package name -> directory, from the root package.json. */
function workspacePackages() {
  const map = new Map();
  for (const ws of readJson(path.join(repoRoot, "package.json")).workspaces ?? []) {
    const pkgFile = path.join(repoRoot, ws, "package.json");
    if (fs.existsSync(pkgFile)) map.set(readJson(pkgFile).name, path.join(repoRoot, ws));
  }
  return map;
}

const builtLibs = new Set();

/** Build workspace libraries a plugin depends on (e.g. inlined at build time). */
function buildLocalDeps(pkg, workspaces) {
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  for (const name of Object.keys(deps)) {
    const dir = workspaces.get(name);
    if (!dir || builtLibs.has(dir) || dir.startsWith(pluginsDir + path.sep)) continue;
    console.log(`  building workspace dependency ${name}`);
    run("npm", ["run", "build"], dir);
    builtLibs.add(dir);
  }
}

function checkPack(tgz, manifest) {
  const entries = run("tar", ["tzf", tgz], repoRoot, { capture: true }).split("\n").filter(Boolean);
  const problems = [];
  const bad = entries.filter((e) => FORBIDDEN.some((re) => re.test(e)));
  if (bad.length > 0) problems.push(`unexpected files: ${bad.slice(0, 5).join(", ")}${bad.length > 5 ? ", ..." : ""}`);
  for (const required of ["package.json", "openclaw.plugin.json", manifest.entry]) {
    const rel = path.posix.normalize(String(required ?? "")).replace(/^\.\//, "");
    if (!entries.includes(`package/${rel}`)) problems.push(`missing ${rel}`);
  }
  if (problems.length > 0) throw new Error(`pack check failed for ${path.basename(tgz)}: ${problems.join("; ")}`);
  return entries.length;
}

function deploy(id, workspaces, install) {
  const dir = path.join(pluginsDir, id);
  const pkg = readJson(path.join(dir, "package.json"));
  console.log(`\n== ${id}`);

  if (!fs.existsSync(path.join(dir, "node_modules")) && !workspaces.has(pkg.name)) {
    throw new Error(`${id} is not an npm workspace; run \`npm install\` in plugins/${id} first`);
  }
  buildLocalDeps(pkg, workspaces);
  run("npm", ["run", "build"], dir);

  const manifestFile = path.join(dir, "openclaw.plugin.json");
  if (!fs.existsSync(manifestFile)) {
    throw new Error(`${id}: openclaw.plugin.json not found after build (its build does not generate one)`);
  }
  const manifest = readJson(manifestFile);

  const staging = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-hub-pack-"));
  try {
    const [info] = JSON.parse(
      run("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", staging], dir, { capture: true }),
    );
    fs.mkdirSync(outDir, { recursive: true });
    const tgz = path.join(outDir, `${manifest.id ?? id}.tgz`);
    fs.copyFileSync(path.join(staging, info.filename), tgz);
    const count = checkPack(tgz, manifest);
    const kb = (fs.statSync(tgz).size / 1024).toFixed(1);
    console.log(`  packed ${path.relative(repoRoot, tgz)} (${kb} KB, ${count} entries)`);

    const installArgs = ["plugins", "install", `npm-pack:${tgz}`, "--force"];
    if (install) {
      run("openclaw", installArgs, repoRoot);
    } else {
      console.log(`  install: openclaw ${installArgs.join(" ")}`);
    }
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("-h") || args.includes("--help")) usage(0);
  const install = args.includes("--install");
  const all = args.includes("--all");
  const unknown = args.filter((a) => a.startsWith("-") && !["--install", "--all"].includes(a));
  if (unknown.length > 0) usage(1);
  const named = args.filter((a) => !a.startsWith("-"));
  if (all === named.length > 0) usage(1);

  const available = listPlugins();
  const ids = all ? available : named;
  const missing = ids.filter((id) => !available.includes(id));
  if (missing.length > 0) {
    console.error(`Unknown plugin(s): ${missing.join(", ")}\nAvailable: ${available.join(", ")}`);
    process.exit(1);
  }

  const workspaces = workspacePackages();
  const failed = [];
  for (const id of ids) {
    try {
      deploy(id, workspaces, install);
    } catch (err) {
      console.error(`  error: ${err instanceof Error ? err.message : err}`);
      failed.push(id);
    }
  }
  if (failed.length > 0) {
    console.error(`\nFailed: ${failed.join(", ")}`);
    process.exit(1);
  }
}

main();
