import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fitCloudflareAssets, PAGES_ASSET_LIMIT, splitGlb } from '../.tools/split_glb.mjs';

function glb(document, binary) {
  const json = Buffer.from(JSON.stringify(document));
  const length = Math.ceil(json.length / 4) * 4;
  const result = Buffer.alloc(28 + length + binary.length);
  result.writeUInt32LE(0x46546c67, 0);
  result.writeUInt32LE(2, 4);
  result.writeUInt32LE(result.length, 8);
  result.writeUInt32LE(length, 12);
  result.writeUInt32LE(0x4e4f534a, 16);
  result.fill(0x20, 20, 20 + length);
  json.copy(result, 20);
  result.writeUInt32LE(binary.length, 20 + length);
  result.writeUInt32LE(0x004e4942, 24 + length);
  binary.copy(result, 28 + length);
  return result;
}

function fixture() {
  const document = {
    asset: { version: '2.0' }, buffers: [{ byteLength: 1804 }],
    bufferViews: [
      { buffer: 0, byteLength: 701, target: 34962 },
      { buffer: 0, byteOffset: 704, byteLength: 300, byteStride: 12 },
      { buffer: 0, byteOffset: 1004, byteLength: 800 },
    ],
    accessors: [{ bufferView: 1, byteOffset: 12, componentType: 5126, count: 24, type: 'VEC3' }],
    images: [{ bufferView: 2, mimeType: 'image/ktx2' }],
    extensionsUsed: ['KHR_texture_basisu'],
  };
  return { document, data: glb(document, Buffer.from(Array.from({ length: 1804 }, (_, i) => i % 251))) };
}

function unpack(data) {
  const end = 20 + data.readUInt32LE(12);
  return { document: JSON.parse(data.toString('utf8', 20, end)), binary: data.subarray(end + 8) };
}

function checkEquivalent(source, files, filename, limit) {
  const before = unpack(source), container = files.get(filename), after = unpack(container).document;
  assert.equal(container.readUInt32LE(8), container.length);
  assert.equal(container.length, 20 + container.readUInt32LE(12), 'external buffers need no BIN chunk');
  for (const bytes of files.values()) assert.ok(bytes.length <= limit);
  for (const buffer of after.buffers) assert.equal(files.get(decodeURIComponent(buffer.uri)).length, buffer.byteLength);
  for (const [index, view] of after.bufferViews.entries()) {
    const original = before.document.bufferViews[index];
    const bytes = files.get(decodeURIComponent(after.buffers[view.buffer].uri));
    assert.equal(view.byteOffset % 4, 0);
    assert.deepEqual(bytes.subarray(view.byteOffset, view.byteOffset + view.byteLength),
      before.binary.subarray(original.byteOffset ?? 0, (original.byteOffset ?? 0) + original.byteLength), `view ${index}`);
    // All consumers retain their original bufferView indices and properties.
    after.bufferViews[index] = { ...view, buffer: original.buffer };
    if (original.byteOffset === undefined) delete after.bufferViews[index].byteOffset;
    else after.bufferViews[index].byteOffset = original.byteOffset;
  }
  after.buffers = before.document.buffers;
  assert.deepEqual(after, before.document);
}

test('small assets stay byte-for-byte unchanged', () => {
  const { data } = fixture();
  const files = splitGlb(data, 'small.glb');
  assert.equal(files.size, 1);
  assert.equal(files.get('small.glb'), data);
});

test('splitting preserves view bytes, alignment, texture references and accessor indices', () => {
  const { data } = fixture(), snapshot = Buffer.from(data);
  const files = splitGlb(data, 'map with spaces.glb', 1024);
  assert.equal(files.size, 3);
  checkEquivalent(data, files, 'map with spaces.glb', 1024);
  assert.deepEqual(data, snapshot, 'source export must not be modified');
});

test('the shipped Nuketown model fits Pages without losing any scene or texture data', async () => {
  const data = await readFile(new URL('../export/web/nuketown_2020_optimized.glb', import.meta.url));
  const files = splitGlb(data, 'nuketown_2020_optimized.glb');
  assert.ok(files.size > 1);
  checkEquivalent(data, files, 'nuketown_2020_optimized.glb', PAGES_ASSET_LIMIT);
});

test('unsplittable or unsupported views fail before producing deployment files', () => {
  const { document, data } = fixture();
  assert.throws(() => splitGlb(data, 'large-view.glb', 700), /buffer view 0 alone exceeds/);
  document.bufferViews[0].extensions = { EXT_meshopt_compression: { buffer: 0 } };
  assert.throws(() => splitGlb(glb(document, Buffer.alloc(1804)), 'compressed.glb', 1024), /meshopt-compressed/);
  delete document.bufferViews[0].extensions;
  document.bufferViews[0].byteOffset = 1800;
  assert.throws(() => splitGlb(glb(document, Buffer.alloc(1804)), 'invalid.glb', 1024), /invalid buffer view/);
});

test('staging writes relative buffers, is repeatable, and rejects oversized non-model assets', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'cloudflare-assets-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { data } = fixture();
  await writeFile(path.join(directory, 'map.glb'), data);
  const split = await fitCloudflareAssets(directory, 1024);
  assert.equal(split.length, 1);
  const files = new Map(await Promise.all((await readdir(directory)).map(async name =>
    [name, await readFile(path.join(directory, name))])));
  checkEquivalent(data, files, 'map.glb', 1024);
  assert.deepEqual(await fitCloudflareAssets(directory, 1024), []);
  await writeFile(path.join(directory, 'too-large.bin'), Buffer.alloc(1025));
  await assert.rejects(fitCloudflareAssets(directory, 1024), /too-large\.bin exceeds Cloudflare/);
});
