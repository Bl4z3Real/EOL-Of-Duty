import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WeaponController } from '../export/web/weapon-controller.js';

test('automatic fire starts immediately and respects its cadence', () => {
  const shots = [];
  const weapon = new WeaponController({ roundsPerMinute: 600, onFire: (shot) => shots.push(shot) });
  weapon.setTrigger(true);

  assert.equal(weapon.update(0.001), 1);
  assert.equal(weapon.update(0.05), 0);
  assert.equal(weapon.update(0.05), 1);
  assert.equal(weapon.magazine, 28);
  assert.equal(shots.length, 2);
});

test('AN-94 hyperburst uses its fast opening interval on every trigger pull', () => {
  const triggerShots = [];
  const weapon = new WeaponController({
    roundsPerMinute: 625,
    initialRoundsPerMinute: 937.5,
    initialShotCount: 2,
    onFire: ({ triggerShotCount }) => triggerShots.push(triggerShotCount),
  });
  weapon.setTrigger(true);

  assert.equal(weapon.update(0), 1, 'the first round is immediate');
  assert.equal(weapon.update(0.063), 0);
  assert.equal(weapon.update(0.002), 1, 'the second round follows after 64 ms');
  assert.equal(weapon.update(0.094), 0);
  assert.equal(weapon.update(0.003), 1, 'sustained fire settles to the 96 ms interval');

  weapon.setTrigger(false);
  weapon.setTrigger(true);
  assert.equal(weapon.update(0), 1, 'a fresh pull starts a fresh hyperburst');
  assert.deepEqual(triggerShots, [1, 2, 3, 1]);
});

test('fire is blocked while sprinting or reloading', () => {
  const weapon = new WeaponController();
  weapon.setTrigger(true);
  assert.equal(weapon.update(0.016, { canFire: false }), 0);
  assert.equal(weapon.magazine, 30);

  weapon.magazine = 12;
  assert.equal(weapon.startReload(), true);
  assert.equal(weapon.update(0.2), 0);
  assert.equal(weapon.magazine, 12);
});

test('reload transfers only available reserve ammunition', () => {
  const weapon = new WeaponController({ magazineSize: 30, reserveAmmo: 7 });
  weapon.magazine = 4;

  assert.equal(weapon.startReload(), true);
  assert.equal(weapon.finishReload(), 7);
  assert.equal(weapon.magazine, 11);
  assert.equal(weapon.reserveAmmo, 0);
  assert.equal(weapon.canReload, false);
});

test('empty trigger notifies once until released', () => {
  let emptyCount = 0;
  const weapon = new WeaponController({ reserveAmmo: 0, onEmpty: () => { emptyCount += 1; } });
  weapon.magazine = 0;
  weapon.setTrigger(true);
  weapon.update(0.1);
  weapon.update(0.1);
  assert.equal(emptyCount, 1);

  weapon.setTrigger(false);
  weapon.setTrigger(true);
  weapon.update(0.1);
  assert.equal(emptyCount, 2);
});

test('a new life restores the complete loadout and clears weapon activity', () => {
  const weapon = new WeaponController({ magazineSize: 30, reserveAmmo: 240 });
  weapon.magazine = 3;
  weapon.reserveAmmo = 17;
  weapon.setTrigger(true);
  weapon.startReload();

  assert.deepEqual(weapon.resetLoadout(), { magazine: 30, reserveAmmo: 240 });
  assert.equal(weapon.triggerHeld, false);
  assert.equal(weapon.reloading, false);
});

test('semi-automatic and burst weapons spend one pull and wait out the cadence', () => {
  const single = new WeaponController({ roundsPerMinute: 625, fireMode: 'single' });
  single.setTrigger(true);
  assert.equal(single.update(0.001), 1, 'one round per pull');
  assert.equal(single.update(0.5), 0, 'holding the trigger fires nothing more');
  single.setTrigger(false);
  single.setTrigger(true);
  assert.equal(single.update(0.001), 1, 'a fresh pull fires again');
  single.setTrigger(false);
  single.setTrigger(true);
  assert.equal(single.update(0.001), 0, 'tapping inside the cooldown waits for the cadence');
  assert.equal(single.update(0.1), 1);

  const burst = new WeaponController({ roundsPerMinute: 938, fireMode: 'burst', burstCount: 3 });
  burst.setTrigger(true);
  let shots = 0;
  for (let i = 0; i < 20; i += 1) shots += burst.update(0.05);
  assert.equal(shots, 3, 'a burst is three rounds however long the trigger is held');
  burst.setTrigger(false);
  burst.setTrigger(true);
  for (let i = 0; i < 20; i += 1) shots += burst.update(0.05);
  assert.equal(shots, 6);

  const auto = new WeaponController({ roundsPerMinute: 750, fireMode: 'hosepipe' });
  assert.equal(auto.fireMode, 'auto', 'an unknown mode is automatic');
});
