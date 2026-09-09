import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';

import {
  AmbienceManager, AMBIENCE_LOOP_RANGE, AMBIENCE_MAX_LOOPS, DEFAULT_SURFACE, StrideTracker, WorldAudio,
  impactSurface, segmentClosestPoint, surfaceFromMaterial,
} from '../export/web/world-audio.js';

test('T6 material names map onto footstep surfaces', () => {
  assert.equal(surfaceFromMaterial('wpc/nt_2020_astroturf_01'), 'grass');
  assert.equal(surfaceFromMaterial('*11n_17(wpc/concrete_base02_shiny:wpc/decal_damage_wall_fillet)'), 'concrete');
  assert.equal(surfaceFromMaterial('wpc/wood_teak_decking_trim_light_512'), 'wood');
  assert.equal(surfaceFromMaterial('mc/metal_chrome_boat'), 'metal');
  assert.equal(surfaceFromMaterial('wpc/hjk_interior_plastic_tile'), 'ceramic', 'tile beats plastic');
  assert.equal(surfaceFromMaterial('nt_2020_carpet_grey_01'), 'carpet');
  assert.equal(surfaceFromMaterial(''), DEFAULT_SURFACE);
  assert.equal(surfaceFromMaterial(undefined), DEFAULT_SURFACE);
});

test('impact debris collapses surfaces onto the bank set', () => {
  assert.equal(impactSurface('concrete'), 'rock');
  assert.equal(impactSurface('grass'), 'dirt');
  assert.equal(impactSurface('metal'), 'metal');
  assert.equal(impactSurface('wood'), 'wood');
  assert.equal(impactSurface('nothing'), 'dirt');
});

test('strides fire once per stride of ground travel and land after air time', () => {
  const tracker = new StrideTracker({ walkStride: 58, sprintStride: 80, minAirTime: 0.12 });
  const at = (x, y = 0) => new THREE.Vector3(x, y, 0);
  assert.deepEqual(tracker.update(at(0), { grounded: true, dt: 0.016 }), { step: false, land: false, drop: 0 });
  let steps = 0;
  for (let x = 10; x <= 120; x += 10) steps += Number(tracker.update(at(x), { grounded: true, dt: 0.016 }).step);
  assert.equal(steps, 2, 'two walk strides in 120 units');
  const sprint = new StrideTracker({ walkStride: 58, sprintStride: 80 });
  sprint.update(at(0), { grounded: true });
  steps = 0;
  for (let x = 10; x <= 120; x += 10) steps += Number(sprint.update(at(x), { grounded: true, sprinting: true }).step);
  assert.equal(steps, 1, 'one sprint stride in 120 units');
  // Jump: no steps in the air, a landing on return that reports the drop.
  const jumper = new StrideTracker();
  jumper.update(at(0, 0), { grounded: true });
  assert.equal(jumper.update(at(20, 30), { grounded: false, dt: 0.1 }).step, false);
  assert.equal(jumper.update(at(40, 45), { grounded: false, dt: 0.1 }).land, false);
  const landing = jumper.update(at(60, 0), { grounded: true, dt: 0.016 });
  assert.equal(landing.land, true);
  assert.equal(landing.drop, 45);
  // A one-frame ground loss on a stair is not a landing.
  const stairs = new StrideTracker({ minAirTime: 0.12 });
  stairs.update(at(0), { grounded: true });
  stairs.update(at(5, 2), { grounded: false, dt: 0.05 });
  assert.equal(stairs.update(at(10, 4), { grounded: true, dt: 0.016 }).land, false);
});

test('closest approach of a bullet path to the listener', () => {
  const a = new THREE.Vector3(0, 0, 0);
  const b = new THREE.Vector3(100, 0, 0);
  const near = segmentClosestPoint(a, b, new THREE.Vector3(50, 30, 0));
  assert.equal(near.distance, 30);
  assert.equal(near.t, 0.5);
  assert.deepEqual(near.point.toArray(), [50, 0, 0]);
  const behind = segmentClosestPoint(a, b, new THREE.Vector3(-40, 0, 0));
  assert.equal(behind.t, 0);
  assert.equal(behind.distance, 40);
});

test('cues resolve to the most specific alias with samples and count attempts', () => {
  const audio = { context: null, output: null, ensureContext: () => null, pannerFor: () => null, listenerPosition: new THREE.Vector3() };
  const world = new WorldAudio(audio);
  world.aliases = {
    fly_lstep_run_grass: 'grass_run',
    fly_lstep_sprint_default: 'dirt_sprint',
    fly_lstep_run_npc_default: 'dirt_run',
    prj_whizby: 'whiz',
    prj_bullet_debris_large_rock: 'rock',
  };
  world.buffers = { grass_run: [{}], dirt_sprint: [{}], dirt_run: [{}], whiz: [{}], rock: [{}] };
  assert.equal(world.resolve(['fly_lstep_run_grass']), 'fly_lstep_run_grass');
  assert.equal(world.resolve(['fly_lstep_run_carpet', 'fly_lstep_run_default']), 'fly_lstep_run_carpet', 'unresolved cues keep their first name for counting');
  assert.equal(world.resolve([null, undefined]), null);
  world.footstep({ surface: 'grass' });
  world.footstep({ surface: 'metal', sprinting: true });
  world.footstep({ surface: 'metal', npc: true });
  world.whizby({ distance: 10 });
  world.bulletImpact({ surface: 'concrete' });
  assert.equal(world.played.fly_lstep_run_grass, 1);
  assert.equal(world.played.fly_lstep_sprint_default, 1, 'unknown surface falls back to default');
  assert.equal(world.played.fly_lstep_run_npc_default, 1);
  assert.equal(world.played.prj_whizby, 1, 'the crack is unavailable so the whiz plays');
  assert.equal(world.played.prj_bullet_debris_large_rock, 1);
  // No audio context: playback reports false but never throws.
  assert.equal(world.play('fly_lstep_run_grass'), false);
});

test('ambience runs loops near the listener and randoms on timers', () => {
  const played = [];
  const audio = { context: null, output: null, ensureContext: () => null, pannerFor: () => ({}), listenerPosition: new THREE.Vector3() };
  const world = new WorldAudio(audio);
  world.aliases = { 'amb_ac@mpl_x.all': 'ac', 'amb_bird_call@mpl_x.all': 'bird', amb_wind_extreior_2d: 'wind' };
  world.buffers = { ac: [{}], bird: [{}], wind: [{}] };
  world.play = (alias, options = {}) => { played.push([alias, options.loop ?? false]); return options.loop ? { source: {}, stop() { played.push(['stop', alias]); } } : true; };
  const ambience = new AmbienceManager(world, [
    { alias: 'amb_ac', mode: 'loop', position: [0, 0, 0] },
    { alias: 'amb_ac', mode: 'loop', position: [5000, 0, 0] },
    { alias: 'amb_bird_call', mode: 'random', position: [100, 0, 0] },
  ], { bank: 'mpl_x.all' });
  ambience.start();
  assert.deepEqual(played[0], ['amb_wind_extreior_2d', true], 'the 2D bed starts with the map');
  ambience.update(0.6, new THREE.Vector3(0, 0, 0));
  assert.ok(played.some(([alias, loop]) => alias === 'amb_ac@mpl_x.all' && loop), 'the near loop starts');
  assert.equal(played.filter(([alias]) => alias === 'amb_ac@mpl_x.all').length, 1, 'the far loop stays silent');
  assert.ok(played.some(([alias]) => alias === 'amb_bird_call@mpl_x.all'), 'a random emitter fires when due');
  // Walk away: the near loop is culled.
  ambience.update(0.6, new THREE.Vector3(4000, 0, 0));
  assert.ok(played.some(([tag, alias]) => tag === 'stop' && alias === 'amb_ac@mpl_x.all'));
  ambience.stop();
  assert.ok(played.some(([tag, alias]) => tag === 'stop' && alias === 'amb_wind_extreior_2d'));
});

test('alias volumes scale the gain and pick the bus, and ranges follow the tables', () => {
  assert.equal(WorldAudio.volumeGain(100), 1);
  assert.ok(WorldAudio.volumeGain(93) > 0.8 && WorldAudio.volumeGain(93) < 0.9, 'the rifle report sits near full level');
  assert.ok(WorldAudio.volumeGain(64) < 0.35, 'an appliance hum sits well under it');
  assert.equal(WorldAudio.volumeGain(undefined), 1, 'a cue with no table entry keeps its gain');
  const audio = { context: null, output: null, ensureContext: () => null, pannerFor: () => null, listenerPosition: new THREE.Vector3() };
  const world = new WorldAudio(audio);
  world.mix = {
    'amb_wind_tunnel@mpl_x.all': { volume: 90, distMin: 12, distMax: 50, bus: 'fx' },
    mus_victory: { volume: 77, distMin: 0, distMax: 5000, bus: 'music' },
    chr_breathing_hurt: { volume: 80, distMin: 0, distMax: 5000, bus: 'voice' },
  };
  assert.equal(world.busFor('amb_wind_tunnel@mpl_x.all'), 'ambience', 'ambience loops leave the gunfire compressor');
  assert.equal(world.busFor('mus_victory'), 'music');
  assert.equal(world.busFor('chr_breathing_hurt'), 'voice');
  assert.equal(world.busFor('prj_whizby'), 'fx');
  assert.equal(world.busFor('prj_whizby', { ui: true }), 'ui');
  assert.equal(world.mixFor('amb_wind_tunnel@mpl_x.all').distMax, 50);
});

test('ambience loops run inside their authored range, nearest first, under a small cap', () => {
  const played = [];
  const panners = [];
  const audio = {
    context: {}, output: {},
    ensureContext: () => ({}),
    pannerFor: (key, position, options) => { panners.push({ key, options }); return { key }; },
    listenerPosition: new THREE.Vector3(),
  };
  const world = new WorldAudio(audio);
  world.aliases = { 'amb_vent@mpl_x.all': 'vent', 'amb_far@mpl_x.all': 'far' };
  world.buffers = { vent: [{}], far: [{}] };
  world.mix = { 'amb_vent@mpl_x.all': { volume: 90, distMin: 12, distMax: 50, bus: 'fx' } };
  world.play = (alias, options) => { played.push([alias, options]); return { stop() {} }; };
  const ambience = new AmbienceManager(world, [
    { alias: 'amb_vent', mode: 'loop', position: [0, 0, 120] },
    { alias: 'amb_far', mode: 'loop', position: [0, 0, 400] },
    { alias: 'amb_vent', mode: 'loop', position: [0, 0, 30] },
  ], { bank: 'mpl_x.all' });
  ambience.start();
  ambience.update(1, new THREE.Vector3(0, 0, 0));
  const loops = played.filter(([, options]) => options.loop).map(([alias]) => alias);
  // The vent 120 units away is past its 50-unit DistMaxDry and stays silent; the
  // one at 30 plays; the untabled emitter uses the default range and plays too.
  assert.deepEqual(loops, ['amb_vent@mpl_x.all', 'amb_far@mpl_x.all']);
  assert.equal(ambience.emitters[0].handle, null);
  assert.ok(ambience.emitters[2].handle);
  const vent = panners.find((p) => p.key === 'amb:2');
  assert.equal(vent.options.maxDistance, 50);
  assert.equal(vent.options.refDistance, 12);
  assert.equal(vent.options.bus, 'ambience');
  assert.ok(AMBIENCE_LOOP_RANGE <= 800 && AMBIENCE_MAX_LOOPS <= 12, 'the fallback range and cap stay modest');
});
