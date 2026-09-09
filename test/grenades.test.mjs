import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';

import {
  Grenade, GrenadeManager, SmokeCloud, GRAVITY, blastDamage, throwVelocity, throwOrigin,
} from '../export/web/grenades.js';
import { EQUIPMENT } from '../export/web/weapons.js';
import { explosionDamage, selectMeleeTarget } from '../export/web/gunplay.js';

// A flat floor at y = 0: any downward ray meets it.
const floor = {
  raycastFirst(ray, near, far) {
    if (ray.direction.y >= 0) return null;
    const distance = -ray.origin.y / ray.direction.y;
    if (distance < near || distance > far) return null;
    return { distance, point: ray.origin.clone().addScaledVector(ray.direction, distance), face: { normal: new THREE.Vector3(0, 1, 0) } };
  },
};

test('a frag flies on a parabola, bounces off the floor, settles and goes off on its fuse', () => {
  const grenade = new Grenade(EQUIPMENT.frag, {
    position: new THREE.Vector3(0, 60, 0),
    velocity: new THREE.Vector3(300, 200, 0),
    fuse: 3.5,
  });
  const events = [];
  let time = 0;
  while (!grenade.done && time < 10) {
    const event = grenade.update(1 / 60, floor);
    if (event) events.push([Math.round(time * 100) / 100, event]);
    time += 1 / 60;
  }
  assert.ok(events.some(([, e]) => e === 'bounce'), 'the grenade hits the floor');
  assert.equal(events.at(-1)[1], 'explode');
  assert.ok(Math.abs(events.at(-1)[0] - 3.5) < 0.05, `fuse should run 3.5 s, went off at ${events.at(-1)[0]}`);
  assert.ok(grenade.position.y >= -1, 'it never falls through the floor');
  assert.ok(grenade.position.x > 200, 'it carried forward before stopping');
  assert.ok(grenade.resting, 'it rolled to a stop before the fuse ended');
});

test('a long frame is sub-stepped so the fuse keeps real time', () => {
  const quick = new Grenade(EQUIPMENT.frag, { position: new THREE.Vector3(0, 60, 0), velocity: new THREE.Vector3(), fuse: 1 });
  assert.equal(quick.update(0.5, null), null);
  assert.equal(quick.update(0.5, null), 'explode');
  const gravity = new Grenade(EQUIPMENT.frag, { position: new THREE.Vector3(0, 1000, 0), velocity: new THREE.Vector3(), fuse: 5 });
  gravity.update(0.5, null);
  // Half a second of free fall: v = g t, s = g t^2 / 2 (Euler lands a little past that).
  assert.ok(Math.abs(gravity.velocity.y + GRAVITY * 0.5) < 1);
  assert.ok(Math.abs((1000 - gravity.position.y) - GRAVITY * 0.125) < GRAVITY * 0.01);
});

test('blast damage falls from the inner to the outer figure and stops at the radius, blocked by cover', () => {
  const spec = EQUIPMENT.frag;
  assert.equal(explosionDamage({ innerDamage: 200, outerDamage: 75, radius: 256 }, 0), 200);
  assert.equal(explosionDamage({ innerDamage: 200, outerDamage: 75, radius: 256 }, 128), 137.5);
  assert.equal(explosionDamage({ innerDamage: 200, outerDamage: 75, radius: 256 }, 256), 0);
  const burst = new THREE.Vector3(0, 0, 0);
  const actors = [
    { id: 'near', position: new THREE.Vector3(50, 0, 0) },
    { id: 'edge', position: new THREE.Vector3(250, 0, 0) },
    { id: 'far', position: new THREE.Vector3(300, 0, 0) },
    { id: 'behindWall', position: new THREE.Vector3(0, 0, 100) },
  ];
  const wall = {
    raycastFirst(ray, near, far) {
      // A wall across +z at z = 40.
      if (ray.direction.z <= 0) return null;
      const distance = 40 / ray.direction.z;
      return distance <= far ? { distance, point: ray.origin.clone().addScaledVector(ray.direction, distance) } : null;
    },
  };
  const hits = blastDamage(spec, burst, actors, wall);
  assert.deepEqual(hits.map((hit) => hit.actor.id), ['near', 'edge']);
  assert.ok(hits[0].damage > 170 && hits[0].damage < 180);
  assert.ok(hits[1].damage > 75 && hits[1].damage < 80);
});

test('throws leave from beside the eye, lofted, carrying the thrower\'s motion', () => {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 60, 0);
  camera.lookAt(0, 60, -100);
  camera.updateMatrixWorld();
  const origin = throwOrigin(camera);
  assert.ok(origin.z < -5 && origin.x > 0 && origin.y < 60, `origin should sit ahead, right and below the eye: ${origin.toArray()}`);
  const velocity = throwVelocity(new THREE.Vector3(0, 0, -1), 920, new THREE.Vector3(100, 0, 0));
  assert.ok(velocity.y > 0, 'the throw is lofted');
  assert.ok(Math.abs(Math.hypot(velocity.y, velocity.z) - 920) < 1, 'the aim component is the file speed');
  assert.ok(velocity.x > 0, 'the thrower\'s own motion carries');
});

test('smoke stands, blocks sight while dense, and thins out', () => {
  const cloud = new SmokeCloud(new THREE.Vector3(0, 0, 0), { radius: 220, duration: 12 });
  const a = new THREE.Vector3(-500, 40, 0);
  const b = new THREE.Vector3(500, 40, 0);
  assert.equal(cloud.blocks(a, b), false, 'a fresh pop has not built up yet');
  cloud.update(1.5);
  assert.equal(cloud.blocks(a, b), true);
  assert.equal(cloud.blocks(a, new THREE.Vector3(-300, 40, 0)), false, 'a line that stops short is clear');
  assert.equal(cloud.blocks(new THREE.Vector3(-500, 40, 400), new THREE.Vector3(500, 40, 400)), false, 'a line past the cloud is clear');
  cloud.update(10.4);
  assert.equal(cloud.blocks(a, b), false, 'the cloud has thinned');
  assert.equal(cloud.done, false);
  cloud.update(1);
  assert.equal(cloud.done, true);
});

test('the manager turns a smoke burst into a cloud and a frag burst into damage', () => {
  const exploded = [];
  const manager = new GrenadeManager({ collision: floor, onExplode: (grenade, hits) => exploded.push([grenade.kind, hits.length]) });
  manager.throw(EQUIPMENT.smoke, { position: new THREE.Vector3(0, 40, 0), velocity: new THREE.Vector3(), fuse: 0.2 });
  manager.throw(EQUIPMENT.frag, { position: new THREE.Vector3(0, 40, 0), velocity: new THREE.Vector3(), fuse: 0.4 });
  const actors = [{ enemy: { id: 'bot' }, position: new THREE.Vector3(60, 40, 0) }];
  for (let i = 0; i < 40; i += 1) manager.update(1 / 60, { actors });
  assert.deepEqual(exploded, [['smoke', 0], ['frag', 1]]);
  assert.equal(manager.clouds.length, 1);
  assert.equal(manager.activeCount, 0);
  manager.update(2, { actors });
  assert.equal(manager.smokeBlocks(new THREE.Vector3(-400, 40, 0), new THREE.Vector3(400, 40, 0)), true);
  manager.update(EQUIPMENT.smoke.smokeDuration, { actors });
  assert.equal(manager.clouds.length, 0, 'the cloud is cleared once its duration runs out');
  assert.equal(manager.smokeBlocks(new THREE.Vector3(-400, 40, 0), new THREE.Vector3(400, 40, 0)), false);
});

test('melee picks the nearest target inside the knife\'s reach cone, with a lunge dead ahead', () => {
  const eye = new THREE.Vector3(0, 60, 0);
  const forward = new THREE.Vector3(0, 0, -1);
  const targets = [
    { id: 'ahead', position: new THREE.Vector3(0, 50, -50) },
    { id: 'closerButBeside', position: new THREE.Vector3(40, 50, -10) },
    { id: 'lunge', position: new THREE.Vector3(3, 50, -95) },
    { id: 'tooFar', position: new THREE.Vector3(0, 50, -120) },
  ];
  assert.equal(selectMeleeTarget(eye, forward, targets).target.id, 'ahead');
  assert.equal(selectMeleeTarget(eye, forward, targets.filter((t) => t.id !== 'ahead')).target.id, 'lunge', 'a target just past reach and dead ahead is lunged to');
  assert.equal(selectMeleeTarget(eye, forward, targets.filter((t) => t.id === 'tooFar')), null);
  assert.equal(selectMeleeTarget(eye, forward, targets.filter((t) => t.id === 'closerButBeside')), null, 'beside the player is outside the cone');
  assert.equal(selectMeleeTarget(eye, forward, []), null);
});
