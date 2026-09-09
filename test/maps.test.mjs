import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DEFAULT_MAP, MAPS, MAP_IDS, MAP_STORAGE_KEY, findMap, isMapId, mapFiles,
  mapIntermediateFiles, mapRequiredFiles, rememberMap, resolveMapId,
} from '../export/web/maps.js';

function memoryStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
  };
}

test('Hijacked stays the default and keeps its original file names', () => {
  assert.equal(DEFAULT_MAP, 'mp_hijacked');
  assert.ok(MAP_IDS.includes('mp_hijacked'));
  assert.ok(MAP_IDS.includes('mp_nuketown_2020'));
  const files = mapFiles(MAPS.mp_hijacked);
  assert.equal(files.render, 'hijacked_optimized.glb');
  assert.equal(files.collisionBvhMeta, 'hijacked_collision_bvh.json');
  assert.equal(files.navmesh, 'hijacked.navmesh.bin');
  assert.equal(files.navHints, 'hijacked_nav_hints.json');
  assert.equal(files.ladders, 'hijacked_ladders.json');
  assert.equal(files.probes, 'hijacked_probes.bin');
  assert.equal(MAPS.mp_hijacked.env, 'textures/env/');
  assert.equal(MAPS.mp_hijacked.baked, true);
  assert.equal(MAPS.mp_hijacked.lut, 'textures/mp_hijacked_lut.png');
});

test('Nuketown 2025 names every baked file from its prefix', () => {
  const map = MAPS.mp_nuketown_2020;
  const files = mapFiles(map);
  for (const name of Object.values(files)) assert.ok(name.startsWith('nuketown_2020'), name);
  assert.equal(files.render, 'nuketown_2020_optimized.glb');
  assert.equal(files.navmesh, 'nuketown_2020.navmesh.bin');
  assert.equal(map.radar, 'ui/hud/compass_map_mp_nuketown2020.png');
  assert.equal(map.card, 'ui/menu_mp_map_select_nuketown2020_final.png');
  assert.equal(map.sources.sky, 'skybox_mp_nuketown2020_ft');
  assert.ok(map.env.startsWith('textures/nuketown_2020/'));
  // The intermediate set never overlaps the shipped set.
  const shipped = new Set(mapRequiredFiles(map));
  for (const name of mapIntermediateFiles(map)) assert.ok(!shipped.has(name), name);
});

test('maps resolve by id, prefix, or short name', () => {
  assert.equal(findMap('mp_nuketown_2020')?.id, 'mp_nuketown_2020');
  assert.equal(findMap('nuketown_2020')?.id, 'mp_nuketown_2020');
  assert.equal(findMap('Hijacked')?.id, 'mp_hijacked');
  assert.equal(findMap('mp_raid'), null);
  assert.equal(findMap(''), null);
  assert.equal(isMapId('mp_hijacked'), true);
  assert.equal(isMapId('constructor'), false);
});

test('query string beats storage, storage beats default, junk falls through', () => {
  const storage = memoryStorage({ [MAP_STORAGE_KEY]: 'mp_hijacked' });
  assert.equal(resolveMapId({ search: '?map=mp_hijacked', storage }), 'mp_hijacked');
  assert.equal(resolveMapId({ search: '?autostart=1', storage }), 'mp_hijacked');
  assert.equal(resolveMapId({ search: '?map=mp_raid', storage: memoryStorage() }), DEFAULT_MAP);
  assert.equal(resolveMapId({ search: '', storage: null }), DEFAULT_MAP);
  assert.equal(resolveMapId({}), DEFAULT_MAP);
});

test('an unbaked map is only reachable by explicit link', () => {
  const maps = { ...MAPS, mp_raid: { ...MAPS.mp_nuketown_2020, id: 'mp_raid', prefix: 'raid', baked: false } };
  const storage = memoryStorage({ [MAP_STORAGE_KEY]: 'mp_raid' });
  assert.equal(resolveMapId({ search: '?map=mp_raid', storage, maps }), 'mp_raid');
  assert.equal(resolveMapId({ search: '', storage, maps }), DEFAULT_MAP);
  const fresh = memoryStorage();
  rememberMap(fresh, 'mp_raid', maps);
  assert.equal(fresh.getItem(MAP_STORAGE_KEY), null);
  rememberMap(fresh, 'mp_nuketown_2020', maps);
  assert.equal(fresh.getItem(MAP_STORAGE_KEY), 'mp_nuketown_2020');
});

test('a throwing storage never breaks map resolution', () => {
  const broken = {
    getItem() { throw new Error('denied'); },
    setItem() { throw new Error('denied'); },
  };
  assert.equal(resolveMapId({ search: '', storage: broken }), DEFAULT_MAP);
  assert.doesNotThrow(() => rememberMap(broken, 'mp_hijacked'));
  const storage = memoryStorage();
  rememberMap(storage, 'mp_raid');
  assert.equal(storage.getItem(MAP_STORAGE_KEY), null);
  rememberMap(storage, 'mp_hijacked');
  assert.equal(storage.getItem(MAP_STORAGE_KEY), 'mp_hijacked');
});

test('a map can hide baked nodes by name, and the batcher leaves them alone', async () => {
  const THREE = await import('three');
  const { hideMapNodes, MAPS } = await import('../export/web/maps.js');
  const root = new THREE.Group();
  const sign = new THREE.Mesh(); sign.name = 'i_fxanim_mp_nuked2025_display_glass_mod';
  const sign2 = new THREE.Mesh(); sign2.name = 'fxanim_mp_nuked2025_display_glass_mod_1';
  const bus = new THREE.Mesh(); bus.name = 'i_mlv/nt_2020_tour_bus';
  root.add(sign, sign2, bus);
  assert.equal(hideMapNodes(root, MAPS.mp_nuketown_2020), 2);
  assert.equal(sign.visible, false);
  assert.equal(sign2.visible, false);
  assert.equal(sign.userData.keepSeparate, true);
  assert.equal(bus.visible, true);
  assert.equal(hideMapNodes(root, MAPS.mp_hijacked), 0, 'Hijacked hides nothing');
  assert.equal(hideMapNodes(null, MAPS.mp_nuketown_2020), 0);
});
