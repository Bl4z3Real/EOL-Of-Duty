// A GLB may reference external buffers. Repack whole buffer views so the
// existing loader can fetch the same geometry/textures within Pages' limit.
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const PAGES_ASSET_LIMIT = 25 * 1024 * 1024;
const align4 = value => Math.ceil(value / 4) * 4;

export function splitGlb(data, filename, limit = PAGES_ASSET_LIMIT) {
  if (data.length <= limit) return new Map([[filename, data]]);
  const fail = message => { throw new Error(`${filename}: ${message}`); };
  if (data.length < 28 || data.readUInt32LE(0) !== 0x46546c67 ||
      data.readUInt32LE(4) !== 2 || data.readUInt32LE(8) !== data.length ||
      data.readUInt32LE(16) !== 0x4e4f534a) fail('expected a GLB 2.0 container');
  const jsonEnd = 20 + data.readUInt32LE(12);
  if (jsonEnd + 8 > data.length || data.readUInt32LE(jsonEnd + 4) !== 0x004e4942 ||
      jsonEnd + 8 + data.readUInt32LE(jsonEnd) !== data.length) fail('expected one embedded BIN chunk');
  const document = JSON.parse(data.toString('utf8', 20, jsonEnd));
  const binary = data.subarray(jsonEnd + 8);
  if (document.buffers?.length !== 1 || document.buffers[0].uri ||
      document.buffers[0].byteLength > binary.length || !document.bufferViews?.length) {
    fail('expected one embedded buffer with buffer views');
  }
  // Meshopt extensions address buffers directly, unlike the shipped map
  // extensions (instancing, quantization and Basis textures). Fail explicitly
  // if a future bake introduces one instead of silently moving its bytes.
  if (document.bufferViews.some(view => view.extensions?.EXT_meshopt_compression ||
      view.extensions?.KHR_meshopt_compression)) fail('meshopt-compressed buffer views need a separate repacker');

  const buffers = [];
  let pieces = [], size = 0;
  const flush = () => {
    if (size) buffers.push(Buffer.concat(pieces, size));
    pieces = []; size = 0;
  };
  for (const [index, view] of document.bufferViews.entries()) {
    const offset = view.byteOffset ?? 0, length = view.byteLength;
    if (view.buffer !== 0 || !Number.isInteger(offset) || offset < 0 ||
        !Number.isInteger(length) || length <= 0 ||
        offset + length > document.buffers[0].byteLength) fail(`invalid buffer view ${index}`);
    if (length > limit) fail(`buffer view ${index} alone exceeds the ${limit}-byte asset limit`);
    if (align4(size) + length > limit) flush();
    const aligned = align4(size);
    if (aligned > size) pieces.push(Buffer.alloc(aligned - size));
    pieces.push(binary.subarray(offset, offset + length));
    view.buffer = buffers.length;
    view.byteOffset = aligned;
    size = aligned + length;
  }
  flush();

  const prefix = filename.replace(/\.glb$/i, '');
  const output = new Map(buffers.map((buffer, index) => [`${prefix}.buffer-${index}.bin`, buffer]));
  const originalBuffer = document.buffers[0];
  document.buffers = [...output].map(([uri, buffer]) => ({
    ...originalBuffer, byteLength: buffer.length, uri: encodeURIComponent(uri),
  }));
  const json = Buffer.from(JSON.stringify(document));
  // The BIN chunk is optional when every buffer has a URI. Keep the .glb
  // entry point so maps.js and existing links need no runtime special case.
  const container = Buffer.alloc(20 + align4(json.length), 0x20);
  container.writeUInt32LE(0x46546c67, 0);
  container.writeUInt32LE(2, 4);
  container.writeUInt32LE(container.length, 8);
  container.writeUInt32LE(container.length - 20, 12);
  container.writeUInt32LE(0x4e4f534a, 16);
  json.copy(container, 20);
  if (container.length > limit) fail('GLB metadata alone exceeds the asset limit');
  output.set(filename, container);
  return output;
}

/** Split oversized staged GLBs and reject other oversized assets before upload. */
export async function fitCloudflareAssets(directory, limit = PAGES_ASSET_LIMIT) {
  const split = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      split.push(...await fitCloudflareAssets(filename, limit));
    } else if (entry.isFile() && (await stat(filename)).size > limit) {
      if (path.extname(entry.name).toLowerCase() !== '.glb') {
        throw new Error(`${filename} exceeds Cloudflare's ${limit}-byte asset limit`);
      }
      const output = splitGlb(await readFile(filename), entry.name, limit);
      // Do not overwrite an unrelated staged asset with a generated part.
      for (const name of output.keys()) {
        if (name === entry.name) continue;
        try { await stat(path.join(directory, name)); }
        catch (error) { if (error.code === 'ENOENT') continue; throw error; }
        throw new Error(`Generated buffer already exists: ${name}`);
      }
      for (const [name, data] of output) await writeFile(path.join(directory, name), data);
      split.push({ file: entry.name, files: [...output].map(([name, data]) => ({ name, bytes: data.length })) });
    }
  }
  return split;
}
