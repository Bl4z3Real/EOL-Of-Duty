// Optimize a composed map for the browser:
//
//   npm run bake:map                              (mp_hijacked)
//   npm run bake:map -- --map mp_nuketown_2020

import { spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_MAP, MAP_IDS, findMap, mapFiles } from '../export/web/maps.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const web = path.join(root, 'export', 'web');

const argv = process.argv.slice(2);
const mapIndex = argv.findIndex((arg) => arg === '--map' || arg === '-m');
const map = findMap(mapIndex >= 0 ? argv[mapIndex + 1] : DEFAULT_MAP);
if (!map) {
  console.error(`usage: node .tools/bake_map.mjs [--map <${MAP_IDS.join('|')}>]`);
  process.exit(2);
}
const files = mapFiles(map);
const source = path.join(web, files.sourceGltf);
const intermediate = path.join(web, files.geometry);
const output = path.join(web, files.render);

function run(args) {
  return new Promise((resolve, reject) => {
    const executable = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    const child = spawn(executable, ['--yes', '@gltf-transform/cli@4.4.2', ...args], {
      cwd: root,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`glTF Transform exited with status ${code}`));
    });
  });
}

try {
  await run([
    'optimize', source, intermediate,
    '--compress', 'meshopt',
    '--flatten', 'false',
    '--join', 'false',
    '--instance', 'true',
    '--instance-min', '3',
    '--palette', 'false',
    '--simplify', 'false',
    '--texture-compress', 'false',
  ]);
  // ETC1S, not UASTC. Every texture in this map is a baseColor map -- there are
  // no normal or metal-rough maps, which are the maps ETC1S actually degrades.
  // UASTC was costing ~34 MB of the 45 MB export for quality nothing here uses.
  await run([
    'etc1s', intermediate, output,
    '--quality', '200',
    '--compression', '5',
    '--jobs', '8',
  ]);
} finally {
  await rm(intermediate, { force: true });
}
