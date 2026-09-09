import { cp, mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_MAP, MAPS, mapIntermediateFiles, mapRecommendedFiles, mapRequiredFiles } from '../export/web/maps.js';
import { fitCloudflareAssets } from './split_glb.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'export', 'web');
const destination = path.join(root, '.work', 'cloudflare-pages');

const maps = Object.values(MAPS);
// Bake inputs and intermediates for every map, whether or not it is baked.
const omittedRootFiles = new Set(maps.flatMap((map) => mapIntermediateFiles(map)));
const keptLooseTextures = new Set(maps.map((map) => path.basename(map.lut)));

function include(candidate) {
  const relative = path.relative(source, candidate);
  if (!relative) return true;
  const segments = relative.split(path.sep);
  if (segments.length === 1 && omittedRootFiles.has(segments[0])) return false;
  if (
    segments.length === 2
    && segments[0] === 'textures'
    && segments[1].endsWith('.png')
    && !keptLooseTextures.has(segments[1])
  ) return false;
  return true;
}

async function exists(relative) {
  try {
    await stat(path.join(source, relative));
    return true;
  } catch {
    return false;
  }
}

// A map the registry calls baked must be complete, or its card would open
// onto a load error. A map not yet marked baked may have files staged early;
// that is only worth a note.
for (const map of maps) {
  const required = mapRequiredFiles(map);
  const present = await Promise.all(required.map(exists));
  if (present.every(Boolean)) {
    if (!map.baked) console.warn(`${map.id} is fully baked but maps.js still has baked: false`);
    continue;
  }
  const missing = required.filter((_, index) => !present[index]);
  if (map.baked || map.id === DEFAULT_MAP) throw new Error(`${map.id} is missing ${missing.join(', ')}`);
}
for (const map of maps.filter((candidate) => candidate.baked)) {
  const recommended = mapRecommendedFiles(map);
  const present = await Promise.all(recommended.map(exists));
  const missing = recommended.filter((_, index) => !present[index]);
  if (missing.length) console.warn(`${map.id} ships without ${missing.join(', ')}`);
}

await mkdir(path.dirname(destination), { recursive: true });
await rm(destination, { recursive: true, force: true });
await cp(source, destination, { recursive: true, filter: include });
for (const result of await fitCloudflareAssets(destination)) {
  console.log(`Split ${result.file}: ${result.files.map(file => `${file.name} (${(file.bytes / 1024 / 1024).toFixed(2)} MiB)`).join(', ')}`);
}
console.log(`Staged Cloudflare Pages assets in ${path.relative(root, destination)}`);
