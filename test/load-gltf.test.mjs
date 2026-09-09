import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadGltf } from '../export/web/load-gltf.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

function loader(parseAsync) {
  return { manager: { resolveURL: value => value, abortController: new AbortController() }, register() {}, parseAsync };
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

function externalModel() {
  return {
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }], meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    buffers: [{ uri: 'geometry.bin', byteLength: 44 }],
    bufferViews: [{ buffer: 0, byteLength: 36 }, { buffer: 0, byteOffset: 36, byteLength: 6 }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] },
      { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' },
    ],
  };
}

test('real GLTFLoader parses external views with one native fetch per buffer and per model', async t => {
  const binary = new ArrayBuffer(44);
  new Float32Array(binary, 0, 9).set([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  new Uint16Array(binary, 36, 3).set([0, 1, 2]);
  const model = externalModel(), requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push(String(url));
    assert.equal(options.headers['X-Model-Test'], 'native');
    assert.equal(options.credentials, 'include');
    return new Response(String(url).endsWith('.gltf') ? JSON.stringify(model) : binary);
  });
  const loader = new GLTFLoader().setRequestHeader({ 'X-Model-Test': 'native' }).setWithCredentials(true);
  loader.manager.setURLModifier(url => url.replace('/original/', '/models/'));
  const [first, second] = await Promise.all([
    loadGltf(loader, 'https://example.test/original/one/scene.gltf'),
    loadGltf(loader, 'https://example.test/original/two/scene.gltf'),
  ]);
  for (const result of [first, second]) {
    const geometry = result.scene.children[0].geometry;
    assert.deepEqual([...geometry.attributes.position.array], [0, 0, 0, 1, 0, 0, 0, 1, 0]);
    assert.deepEqual([...geometry.index.array], [0, 1, 2]);
  }
  assert.equal(requests.length, 4);
  assert.equal(requests.filter(url => url === 'https://example.test/models/one/geometry.bin').length, 1);
  assert.equal(requests.filter(url => url === 'https://example.test/models/two/geometry.bin').length, 1);
});

test('external buffer HTTP, truncation and body errors reject the model', async t => {
  const model = externalModel();
  let bufferResponse = () => new Response('', { status: 404 });
  t.mock.method(globalThis, 'fetch', async url => String(url).endsWith('.gltf')
    ? new Response(JSON.stringify(model)) : bufferResponse());
  const loader = new GLTFLoader();
  const load = () => loadGltf(loader, 'https://example.test/map/scene.gltf');
  await assert.rejects(load(), /HTTP 404/);
  bufferResponse = () => new Response(new Uint8Array(8));
  await assert.rejects(load(), /truncated buffer/);
  bufferResponse = () => new Response(new ReadableStream({ start(controller) { controller.error(new Error('connection interrupted')); } }));
  await assert.rejects(load(), /connection interrupted/);
});
