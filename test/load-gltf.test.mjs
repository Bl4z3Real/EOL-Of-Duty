import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadGltf } from '../export/web/load-gltf.js';

function loader(parseAsync) {
  return { manager: { resolveURL: value => value, abortController: new AbortController() }, parseAsync };
}

test('model loading drains all chunks, reports progress and keeps the texture base path', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2]));
      controller.enqueue(new Uint8Array([3, 4, 5]));
      controller.close();
    },
  }), { headers: { 'Content-Length': '5' } }));
  const progress = [];
  const result = await loadGltf(loader(async (data, base) => {
    assert.deepEqual([...new Uint8Array(data)], [1, 2, 3, 4, 5]);
    assert.equal(base, 'https://example.test/viewmodel/');
    return 'parsed';
  }), 'https://example.test/viewmodel/weapon.glb', event => progress.push(event.loaded));
  assert.equal(result, 'parsed');
  assert.deepEqual(progress, [0, 5]);
});

test('HTTP and interrupted-body failures never reach model parsing', async t => {
  const parse = t.mock.fn();
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 404 }));
  await assert.rejects(loadGltf(loader(parse), 'https://example.test/missing.glb'), /HTTP 404/);
  fetch.mock.mockImplementation(async () => new Response(new ReadableStream({
    start(controller) { controller.error(new Error('connection interrupted')); },
  })));
  await assert.rejects(loadGltf(loader(parse), 'https://example.test/broken.glb', () => {}), /connection interrupted/);
  assert.equal(parse.mock.callCount(), 0);
});
