import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';

import { Destructibles, collectDestructibles, GRAVITY, PART_NAME } from '../export/web/destructibles.js';
import { optimizeStaticScene } from '../export/web/scene-optimizer.js';

const PARTS = [['body', 30], ['head', 66], ['arm_left', 45], ['arm_right', 45]];

// Like the composer's output: the geometry sits above the stand's origin,
// which is on the floor.
function partGeometry(height) {
  return new THREE.BoxGeometry(6, 10, 6).translate(0, height, 0);
}

function mannequin(root, id, origin) {
  const material = new THREE.MeshBasicMaterial();
  const parts = {};
  for (const [part, height] of PARTS) {
    const mesh = new THREE.Mesh(partGeometry(height), material);
    mesh.name = `dm_${id}_${part}`;
    mesh.position.copy(origin);
    root.add(mesh);
    parts[part] = mesh;
  }
  return parts;
}

function instancedMannequins(root, origins) {
  const material = new THREE.MeshBasicMaterial();
  const parts = {};
  for (const [part, height] of PARTS) {
    const mesh = new THREE.InstancedMesh(partGeometry(height), material, origins.length);
    // The instancing pass drops the node name; the mesh name survives.
    mesh.name = `dest_nt_nuked_female_01_d0_${part}${part === 'head' ? '_1' : ''}`;
    origins.forEach((origin, index) => mesh.setMatrixAt(index, new THREE.Matrix4().makeTranslation(origin.x, origin.y, origin.z)));
    root.add(mesh);
    parts[part] = mesh;
  }
  return parts;
}

test('part names match both the node and the instanced mesh form', () => {
  assert.equal(PART_NAME.exec('dm_12_arm_left')[1], 'arm_left');
  assert.equal(PART_NAME.exec('dest_nt_nuked_male_03_d0_head_2')[1], 'head');
  assert.equal(PART_NAME.exec('i_dest_nt_nuked_male_03_d0'), null);
  assert.equal(PART_NAME.exec('world_shell_1024_0_0'), null);
});

test('collects mannequin parts and keeps them out of static batches', () => {
  const root = new THREE.Group();
  const a = mannequin(root, 0, new THREE.Vector3(0, 0, 0));
  mannequin(root, 1, new THREE.Vector3(40, 0, 0));
  const other = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  other.name = 'i_nt_2020_chair';
  root.add(other);

  const entries = collectDestructibles(root);
  assert.equal(entries.length, 8);
  assert.equal(a.head.userData.destructible.part, 'head');

  // Two identical head meshes in one cell would normally become one batch.
  const stats = optimizeStaticScene(root, { cellSize: 640 });
  assert.equal(stats.batches, 0);
  assert.ok(root.children.includes(a.head));
});

test('a hit on a part sends it flying and later rounds pass through the gap', () => {
  const scene = new THREE.Scene();
  const root = new THREE.Group();
  scene.add(root);
  const parts = mannequin(root, 0, new THREE.Vector3(100, -60, 0));
  const played = [];
  const world = { play: (alias, options) => played.push([alias, options]) };
  const destructibles = new Destructibles(root, { scene, world });
  assert.equal(destructibles.count, 1);
  assert.equal(destructibles.meshes.length, 4);

  const bodyHit = destructibles.hit(parts.body, new THREE.Vector3(100, -30, 0), new THREE.Vector3(1, 0, 0));
  assert.deepEqual(bodyHit, { surface: 'plastic', detached: false, part: 'body' });
  assert.equal(destructibles.debris.length, 0);

  const headPoint = new THREE.Vector3(100, 6, 0);
  const headHit = destructibles.hit(parts.head, headPoint, new THREE.Vector3(1, 0, 0));
  assert.equal(headHit.detached, true);
  assert.equal(destructibles.meshes.length, 3);
  assert.equal(parts.head.parent.parent, scene);
  assert.ok(destructibles.isDetachedSpace(headPoint));
  assert.ok(!destructibles.isDetachedSpace(new THREE.Vector3(100, -30, 0)));
  assert.equal(played[0][0], 'fly_bump_mannequin');

  // The piece pivots about the head's own centre, not the stand's origin.
  const start = destructibles.debris[0].pivot.position.clone();
  assert.ok(Math.abs(start.y - 6) < 1e-6, `head pivot at ${start.y}`);
  const headWorld = parts.head.getWorldPosition(new THREE.Vector3());
  assert.ok(Math.abs(headWorld.y + 60) < 1e-6, 'the mesh keeps its world transform under the pivot');

  // It falls under gravity and comes to rest on the stand's floor.
  let peak = start.y;
  for (let i = 0; i < 400; i += 1) {
    destructibles.update(1 / 60);
    peak = Math.max(peak, destructibles.debris[0]?.pivot.position.y ?? -Infinity);
  }
  const piece = destructibles.debris[0];
  assert.ok(piece.resting, 'piece settled');
  assert.ok(peak > start.y, 'piece arced upward first');
  assert.ok(piece.pivot.position.y < start.y && piece.pivot.position.y > -70, `rests near the floor, at ${piece.pivot.position.y}`);
  assert.ok(piece.pivot.position.x > 100, 'carried along the shot');

  // A second hit on the same part is a plain plastic hit once it is loose.
  assert.equal(destructibles.hit(parts.head, headPoint, new THREE.Vector3(1, 0, 0)).detached, false);
  assert.equal(destructibles.debris.length, 1);
  assert.ok(GRAVITY > 0);
});

test('an instanced part hides its instance and launches a copy', () => {
  const scene = new THREE.Scene();
  const root = new THREE.Group();
  scene.add(root);
  const origins = [new THREE.Vector3(0, -60, 0), new THREE.Vector3(80, -60, 0), new THREE.Vector3(160, -60, 0)];
  const parts = instancedMannequins(root, origins);
  const destructibles = new Destructibles(root, { scene });
  assert.equal(destructibles.count, 3);
  assert.equal(destructibles.meshes.length, 4);

  const point = new THREE.Vector3(80, 6, 0);
  const hit = destructibles.hit(parts.head, point, new THREE.Vector3(0, 0, 1), 1);
  assert.equal(hit.detached, true);
  assert.equal(destructibles.debris.length, 1);
  const piece = destructibles.debris[0];
  assert.ok(Math.abs(piece.pivot.position.x - 80) < 1e-6 && Math.abs(piece.pivot.position.y - 6) < 1e-6, 'copy starts at the instance');
  assert.equal(piece.mesh.geometry, parts.head.geometry);
  assert.equal(piece.restY, -60);

  // The instance itself is scaled away; its neighbours are untouched.
  const matrix = new THREE.Matrix4();
  parts.head.getMatrixAt(1, matrix);
  assert.equal(new THREE.Vector3().setFromMatrixScale(matrix).length(), 0);
  parts.head.getMatrixAt(2, matrix);
  assert.equal(new THREE.Vector3().setFromMatrixPosition(matrix).x, 160);

  // The same instance again is just a plastic hit; another instance comes off.
  assert.equal(destructibles.hit(parts.head, point, new THREE.Vector3(0, 0, 1), 1).detached, false);
  assert.equal(destructibles.hit(parts.head, new THREE.Vector3(160, 6, 0), new THREE.Vector3(0, 0, 1), 2).detached, true);
  assert.equal(destructibles.debris.length, 2);
  assert.equal(destructibles.hit(parts.body, new THREE.Vector3(0, -30, 0), new THREE.Vector3(0, 0, 1), 0).detached, false);
});
