import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  AdsBlend, BODY_PENETRATION_SCALE, PENETRATION_BUDGET, SURFACE_PENETRATION_SCALE, SpreadModel, SprintGate,
  VIEW_KICK_RADIANS, ViewKick, damageAtDistance, locationMultiplier, passSurface, penetrationClass,
} from '../export/web/gunplay.js';
import { WEAPON_BALLISTICS } from '../export/web/weapon-ballistics.js';

const m27 = WEAPON_BALLISTICS.m27;

test('ballistics module covers the rifle and pistol roster with weapon-file values', () => {
  assert.deepEqual(Object.keys(WEAPON_BALLISTICS).sort(), [
    'an94', 'beretta93r', 'fiveseven', 'fnp45', 'kard', 'm27', 'sa58', 'saritch', 'scar', 'sig556', 'tar21', 'type95', 'xm8',
  ]);
  // Five-seven: 55 to 100 units, then the pistol falloff down to 19.
  assert.equal(WEAPON_BALLISTICS.fiveseven.damage, 55);
  assert.equal(WEAPON_BALLISTICS.fiveseven.penetrateType, 'small');
  assert.equal(damageAtDistance(WEAPON_BALLISTICS.fiveseven, 1600), 19);
  assert.equal(m27.damage, 33);
  assert.equal(m27.hipSpread.standMin, 3);
  assert.equal(m27.hipKick.pitchMax, 50);
  assert.equal(m27.sprintOutTime, 0.2);
  assert.equal(WEAPON_BALLISTICS.sa58.damage, 55);
});

test('damage steps down by range the way the weapon file lays it out', () => {
  // M27: 33 to 500, 30 from 501, 22 from 1301.
  assert.equal(damageAtDistance(m27, 0), 33);
  assert.equal(damageAtDistance(m27, 500), 33);
  assert.equal(damageAtDistance(m27, 501), 30);
  assert.equal(damageAtDistance(m27, 1300), 30);
  assert.equal(damageAtDistance(m27, 1301), 22);
  assert.equal(damageAtDistance(m27, 9000), 22);
  // FAL: 55 to 650, 49 to 2300, then 40.
  assert.equal(damageAtDistance(WEAPON_BALLISTICS.sa58, 700), 49);
  assert.equal(damageAtDistance(WEAPON_BALLISTICS.sa58, 2301), 40);
});

test('locational multipliers come from the file and default to locNone', () => {
  assert.equal(locationMultiplier(m27, 'head'), 1.1);
  assert.equal(locationMultiplier(m27, 'torso'), 1);
  assert.equal(locationMultiplier(m27, 'legs'), 1);
  assert.equal(locationMultiplier(m27, 'tail'), 1);
});

test('hip spread rests at the stance minimum, blooms per shot, and decays', () => {
  const spread = new SpreadModel(m27);
  assert.equal(spread.angleDegrees(), 3);
  assert.equal(spread.angleDegrees({ crouched: true }), 2.5);
  assert.equal(spread.angleDegrees({ moveFactor: 1 }), 6.75, 'movement is capped at hipSpreadMax');
  for (let i = 0; i < 20; i++) spread.onShot();
  assert.equal(spread.angleDegrees(), 6.75, 'bloom is capped at hipSpreadMax');
  spread.update(0.5);
  assert.ok(spread.angleDegrees() < 6.75 && spread.angleDegrees() > 3, 'decays at hipSpreadDecayRate');
  spread.update(10);
  assert.equal(spread.angleDegrees(), 3);
  assert.equal(spread.angleDegrees({ moveFactor: 1, aimBlend: 1 }), 0, 'ADS collapses to adsSpread');
});

test('spread samples stay inside the cone and fill the disc', () => {
  const spread = new SpreadModel(m27);
  const radius = 3 * Math.PI / 180;
  let maxR = 0;
  for (let i = 0; i < 500; i++) {
    const [yaw, pitch] = spread.sample();
    maxR = Math.max(maxR, Math.hypot(yaw, pitch));
  }
  assert.ok(maxR <= radius + 1e-9);
  assert.ok(maxR > radius * 0.9, 'samples reach the edge of the cone');
  assert.deepEqual(new SpreadModel(m27).sample({ aimBlend: 1 }), [0, 0]);
});

test('view kick draws inside the file range and recentres a share of it', () => {
  const kick = new ViewKick(m27);
  const shot = kick.onShot({}, () => 1);
  assert.ok(Math.abs(shot.pitch - 50 * VIEW_KICK_RADIANS) < 1e-12);
  assert.ok(Math.abs(shot.yaw - 35 * VIEW_KICK_RADIANS) < 1e-12);
  let returned = 0;
  for (let i = 0; i < 60; i++) returned += kick.update(1 / 60).pitch;
  assert.ok(Math.abs(returned + shot.pitch * 0.55) < 1e-6, 'about 55% of the kick is returned');
  assert.equal(kick.pitchOffset, 0);

  // A negative pitch minimum can also kick down; the AN-94 only kicks up.
  const an94 = new ViewKick(WEAPON_BALLISTICS.an94);
  assert.ok(an94.onShot({}, () => 0).pitch > 0);
  // adsViewKickMinMagnitude lifts a tiny aimed kick to the floor.
  const tiny = new ViewKick({ adsKick: { pitchMin: 0, pitchMax: 1, yawMin: 0, yawMax: 0, centerSpeed: 1000, minMagnitude: 25 } });
  assert.ok(Math.abs(tiny.onShot({ aimBlend: 1 }, () => 0.5).pitch - 25 * VIEW_KICK_RADIANS) < 1e-12);
});

test('flinch scales with damage and pushes away from the shooter side', () => {
  const kick = new ViewKick(m27);
  const left = kick.flinch(24, { side: -1 }, () => 0.5);
  assert.ok(left.pitch > 0);
  assert.ok(left.yaw < 0);
  const heavy = new ViewKick(m27).flinch(60, { side: 1 }, () => 0.5);
  assert.ok(heavy.pitch > left.pitch);
});

test('sprint gate blocks fire during sprint and for sprintOutTime after', () => {
  const gate = new SprintGate(m27);
  assert.deepEqual(gate.update(0.016, { wantsSprint: true }), { sprinting: true, canFire: false });
  // Pulling the trigger ends the sprint but the gun needs 0.2s to come up.
  let state = gate.update(0.016, { wantsSprint: true, triggerHeld: true });
  assert.equal(state.sprinting, false);
  assert.equal(state.canFire, false);
  state = gate.update(0.1, { wantsSprint: true, triggerHeld: true });
  assert.equal(state.canFire, false);
  state = gate.update(0.1, { wantsSprint: true, triggerHeld: true });
  assert.equal(state.canFire, true);
  // The interrupt holds until sprint is released, then sprint works again.
  assert.equal(gate.update(0.016, { wantsSprint: true }).sprinting, false);
  gate.update(0.016, { wantsSprint: false });
  assert.equal(gate.update(0.016, { wantsSprint: true }).sprinting, true);
});

test('ADS blend takes the file transition time and eases', () => {
  const ads = new AdsBlend(m27);
  ads.update(0.125, true);
  assert.ok(Math.abs(ads.value - 0.5) < 1e-9, 'half way at half the raise time');
  ads.update(0.125, true);
  assert.equal(ads.value, 1);
  ads.update(0.25, false);
  assert.equal(ads.value, 0);
});

test('penetration: glass and fences are free, thin cover spends budget, walls stop', () => {
  assert.equal(m27.penetrateType, 'medium');
  assert.equal(PENETRATION_BUDGET.medium, 2);
  assert.equal(penetrationClass('glass', 'wpc/glass_clear_mp'), 'free');
  assert.equal(penetrationClass('wood', 'wpc/nt_wood_fence'), 'free', 'a fence is open even when it is wood');
  assert.equal(penetrationClass('metal', 'wpc/chainlink_fence_rusty'), 'free');
  assert.equal(penetrationClass('wood', 'wpc/wood_teak_decking'), 'thin');
  assert.equal(penetrationClass('plaster', 'wpc/nt_2020_wall_tan'), 'thin');
  assert.equal(penetrationClass('concrete', 'wpc/concrete_base02'), 'solid');
  assert.equal(penetrationClass('metal', 'wpc/metal_panel'), 'solid');

  // Two thin walls for a medium rifle, then the third stops it.
  let state = passSurface('wood', 'crate', PENETRATION_BUDGET.medium);
  assert.deepEqual(state, { remaining: 1, scale: SURFACE_PENETRATION_SCALE });
  state = passSurface('plaster', 'wall', state.remaining);
  assert.deepEqual(state, { remaining: 0, scale: SURFACE_PENETRATION_SCALE });
  assert.equal(passSurface('wood', 'crate', state.remaining), null);
  // Glass never spends the budget and never scales the damage.
  assert.deepEqual(passSurface('glass', 'window', 0), { remaining: 0, scale: 1 });
  // A rifle with no penetration stops at the first thin surface.
  assert.equal(passSurface('wood', 'crate', PENETRATION_BUDGET.none), null);
  assert.ok(BODY_PENETRATION_SCALE > 0.5 && BODY_PENETRATION_SCALE < 1);
});
