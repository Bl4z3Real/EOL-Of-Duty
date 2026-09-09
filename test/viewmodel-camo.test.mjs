import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { Viewmodel } from '../export/web/viewmodel.js';

// T6 ships the magazine as its own attachment xmodel, so a camo that only
// reaches the receiver leaves a mismatched magazine hanging off the gun. Both
// roots are painted, and only the `_camo` materials on them.
function buildGun() {
  const viewmodel = new Viewmodel();
  const mesh = (materialName) => new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshBasicMaterial({ name: materialName }),
  );

  const weapon = new THREE.Object3D();
  const receiver = mesh('mc/mtl_t6_wpn_ar_hk416_camo');
  const optic = mesh('mc/mtl_t6_attach_tritium_red');
  weapon.add(receiver, optic);

  const magazine = new THREE.Object3D();
  const clip = mesh('mc/mtl_t6_wpn_ar_hk416_mag_camo1');
  magazine.add(clip);

  viewmodel.camoRoots = [weapon, magazine];
  viewmodel.camoTextures = new Map(
    viewmodel.availableCamos.map((name) => [name, new THREE.Texture()]),
  );
  return { viewmodel, receiver, clip, optic };
}

test('the catalog leads with the camo the gun already wore', () => {
  const viewmodel = new Viewmodel();
  // The two project camos first, then the game's own unlock camos.
  assert.deepEqual(viewmodel.availableCamos.slice(0, 3), ['openai', 'claude', 'erdl']);
  assert.ok(viewmodel.availableCamos.length >= 20, 'the Black Ops II camo set is in the catalog');
  assert.equal(viewmodel.camo, 'openai');
});

test('an unknown camo name falls back rather than loading nothing', () => {
  assert.equal(new Viewmodel({ camo: 'woodland' }).camo, 'openai');
});

test('selecting a camo paints the receiver and the separate magazine', () => {
  const { viewmodel, receiver, clip, optic } = buildGun();
  const claude = viewmodel.camoTextures.get('claude');

  assert.equal(viewmodel.setCamo('claude'), true);
  assert.equal(viewmodel.camo, 'claude');
  assert.equal(receiver.material.map, claude);
  assert.equal(clip.material.map, claude);
  // The sight insert is what ADS aims on; tinting it white would wash out the
  // tritium. Only `_camo` materials are repainted.
  assert.equal(optic.material.map, null);
});

test('camo textures tile across the gun instead of stretching once', () => {
  const { viewmodel, receiver } = buildGun();
  viewmodel.setCamo('claude');

  assert.equal(receiver.material.map.wrapS, THREE.RepeatWrapping);
  assert.equal(receiver.material.map.wrapT, THREE.RepeatWrapping);
  assert.equal(receiver.material.map.colorSpace, THREE.SRGBColorSpace);
});

test('cycling walks the catalog and wraps at both ends', () => {
  const { viewmodel } = buildGun();

  assert.equal(viewmodel.cycleCamo(), 'claude');
  assert.equal(viewmodel.cycleCamo(), 'erdl');
  assert.equal(viewmodel.cycleCamo(-2), 'openai');
  assert.equal(viewmodel.cycleCamo(-1), viewmodel.availableCamos.at(-1), 'stepping back from the first wraps to the last');
  assert.equal(viewmodel.cycleCamo(), 'openai');
});

test('a Black Ops II camo tiles at its own repeat and paints the gun', () => {
  const { viewmodel, receiver } = buildGun();
  assert.equal(viewmodel.setCamo('kryptek_typhon'), true);
  assert.equal(viewmodel.camo, 'kryptek_typhon');
  assert.equal(receiver.material.map.repeat.x, 2, 'the game camos are authored at a larger scale than the two project tiles');
});

test('cycling reports the camo on the gun when the next one never loaded', () => {
  const { viewmodel, receiver } = buildGun();
  const openai = viewmodel.camoTextures.get('openai');
  viewmodel.setCamo('openai');
  viewmodel.camoTextures.delete('claude');

  // The key binding and debug state read this back as the current skin, so it
  // must not claim a camo the gun is not wearing.
  assert.equal(viewmodel.cycleCamo(), 'openai');
  assert.equal(viewmodel.camo, 'openai');
  assert.equal(receiver.material.map, openai);
});
