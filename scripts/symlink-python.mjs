#!/usr/bin/env node
// Symlinks Python files from src/ into dist/ for each plugin that has them.
// OpenClaw loads tools from dist/, but Python files aren't compiled by tsc.

import { readdirSync, symlinkSync, existsSync, lstatSync, readlinkSync, unlinkSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';

export function refreshPythonSymlinks(pluginsDir = join(resolve(import.meta.dirname, '..'), 'plugins')) {
  for (const entry of readdirSync(pluginsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;

    const name = entry.name;
    const src = join(pluginsDir, name, 'src');
    const dist = join(pluginsDir, name, 'dist');
    if (!existsSync(src) || !existsSync(dist)) continue;

    for (const file of readdirSync(src)) {
      if (!file.endsWith('.py')) continue;

      const target = join(dist, file);
      const source = resolve(src, file);
      const targetStat = lstatSync(target, { throwIfNoEntry: false });
      if (targetStat) {
        if (targetStat.isDirectory()) {
          throw new Error(`Refusing to replace directory ${target}`);
        }
        if (targetStat.isSymbolicLink()) {
          const current = resolve(dist, readlinkSync(target));
          if (current === source) continue;
        }
        unlinkSync(target);
      }

      symlinkSync(source, target);
      console.log(`  ${name}/dist/${file} → src/${file}`);
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  refreshPythonSymlinks();
}
