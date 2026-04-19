import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readlinkSync, symlinkSync, unlinkSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

import { refreshPythonSymlinks } from '../symlink-python.mjs';

function makePlugin(root, name) {
  const pluginDir = join(root, name);
  mkdirSync(join(pluginDir, 'src'), { recursive: true });
  mkdirSync(join(pluginDir, 'dist'), { recursive: true });
  return pluginDir;
}

test('refreshPythonSymlinks replaces stale real files with live symlinks', () => {
  const pluginsDir = mkdtempSync(join(tmpdir(), 'openclaw-symlink-'));
  const pluginDir = makePlugin(pluginsDir, 'homeassistant');
  const source = join(pluginDir, 'src', 'tools.py');
  const target = join(pluginDir, 'dist', 'tools.py');

  writeFileSync(source, 'print("live")\n');
  writeFileSync(target, 'print("stale")\n');

  refreshPythonSymlinks(pluginsDir);

  assert.equal(existsSync(target), true);
  assert.equal(resolve(join(pluginDir, 'dist'), readlinkSync(target)), source);
});

test('refreshPythonSymlinks repairs dangling symlinks after plugin renames', () => {
  const pluginsDir = mkdtempSync(join(tmpdir(), 'openclaw-symlink-'));
  const pluginDir = makePlugin(pluginsDir, 'llmvision');
  const source = join(pluginDir, 'src', 'tools.py');
  const target = join(pluginDir, 'dist', 'tools.py');

  writeFileSync(source, 'print("updated")\n');
  symlinkSync('/tmp/old-plugin/src/tools.py', target);

  refreshPythonSymlinks(pluginsDir);

  assert.equal(resolve(join(pluginDir, 'dist'), readlinkSync(target)), source);
});
