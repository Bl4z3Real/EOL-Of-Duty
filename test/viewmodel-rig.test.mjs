import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import { Viewmodel, mountWeaponAttachment, hideModelTags } from '../export/web/viewmodel.js';

const close = (actual, expected) => assert.ok(actual.distanceTo(expected) < 0.002, `${actual.toArray()} != ${expected.toArray()}`);

test('attachment offsets and roll use the weapon joint axes once', () => {
  const gun = new THREE.Group();
  const model = new THREE.Group();
  const bone = new THREE.Bone();
  bone.rotation.x = -Math.PI / 2; // Exporter's Y-up conversion on the root.
  model.add(bone);
  mountWeaponAttachment(model, gun, [4.473, -1.085, -1.5], [-Math.PI / 12, 0, 0]);
  gun.updateMatrixWorld(true);
  close(bone.getWorldPosition(new THREE.Vector3()), new THREE.Vector3(4.473, -1.085, -1.5));
  close(bone.localToWorld(new THREE.Vector3(0, 0, 1)), new THREE.Vector3(4.473, -1.085 + Math.sin(Math.PI / 12), -1.5 + Math.cos(Math.PI / 12)));
});

test('embedded pistol magazines follow authored engine-axis displacements and seat at the same well', async () => {
  const vm = new Viewmodel();
  const gun = new THREE.Bone(); gun.name = 'j_gun';
  const empty = new THREE.Bone(); empty.name = 'tag_clip'; empty.position.set(-1.474159, 0, -1.361017);
  const fresh = new THREE.Bone(); fresh.name = 'tag_clip_full'; fresh.position.set(-20.000761, 0, -1.361017);
  gun.add(empty, fresh); vm.root.add(gun);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => ({ ok: true, json: async () => JSON.parse(await fs.readFile(new URL('../export/web/'+url, import.meta.url), 'utf8')) });
  try {
    await vm.loadClips({ idle: 'viewmodel/anims/viewmodel_fn57_idle.json', reload: 'viewmodel/anims/viewmodel_fn57_reload.json' });
  } finally { globalThis.fetch = originalFetch; }
  assert.ok(fresh.position.distanceTo(empty.position) > 50, 'idle spare stays outside the view');
  vm.idleAction.stop();
  const action = vm.reloadAction.reset().play();
  action.time = action.getClip().duration - 0.001;
  vm.mixer.update(0);
  close(fresh.position, new THREE.Vector3(-1.474159, 0, -1.361017));
});

test('hidden sight variants remove only their weighted faces without modifying shared geometry', () => {
  const root = new THREE.Group(), gun = new THREE.Bone(), hidden = new THREE.Bone();
  hidden.name = 'tag_sights_off'; gun.add(hidden);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Array(18).fill(0), 3));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute([0,0,0,0, 0,0,0,0, 0,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0],4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute([1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0],4));
  geometry.setIndex([0,1,2,3,4,5]);
  const mesh = new THREE.SkinnedMesh(geometry); mesh.add(gun); mesh.bind(new THREE.Skeleton([gun,hidden])); root.add(mesh);
  hideModelTags(root, ['tag_sights_off']);
  assert.deepEqual(Array.from(mesh.geometry.index.array), [0,1,2]);
  assert.equal(geometry.index.count, 6);
  assert.equal(hidden.parent, gun, 'animation skeleton remains intact');
});
