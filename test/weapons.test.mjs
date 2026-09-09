import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import {
  WEAPONS, WEAPON_IDS, WEAPON_CLASSES, WEAPON_CLASS_IDS, EQUIPMENT, MELEE, THROW_CLIPS, DEFAULT_LOADOUT,
  weaponsOfClass, equipmentOfClass, findWeapon, weaponCue, randomLoadout, nextHeldWeapon,
} from '../export/web/weapons.js';
import { WEAPON_BALLISTICS } from '../export/web/weapon-ballistics.js';

const web = path.join(import.meta.dirname, '..', 'export', 'web');
const shipped = (url) => fs.existsSync(path.join(web, url));

test('the registry carries nine rifles and four pistols with the game stats', () => {
  assert.equal(weaponsOfClass('primary').length, 9);
  assert.deepEqual(weaponsOfClass('secondary').map((w) => w.id), ['fiveseven', 'fnp45', 'kard', 'beretta93r']);
  assert.deepEqual(WEAPON_CLASS_IDS, ['primary', 'secondary', 'lethal', 'tactical']);
  // Five-seven: fiveseven_mp verbatim, two spare magazines as the game deals.
  const fiveseven = WEAPONS.fiveseven;
  assert.equal(fiveseven.magazineSize, 20);
  assert.equal(fiveseven.reserveAmmo, 40);
  assert.equal(fiveseven.roundsPerMinute, 750);
  assert.equal(fiveseven.fireMode, 'single');
  assert.equal(fiveseven.magazineUrl, null, 'pistol magazines are part of the gun model');
  // The B23R is the burst pistol and the KAP-40 the automatic.
  assert.equal(WEAPONS.beretta93r.fireMode, 'burst');
  assert.equal(WEAPONS.beretta93r.burstCount, 3);
  assert.equal(WEAPONS.kard.fireMode, 'auto');
  // Rifles keep the fire types the class screen showed.
  assert.equal(WEAPONS.sa58.fireMode, 'single');
  assert.equal(WEAPONS.xm8.fireMode, 'burst');
  assert.equal(WEAPONS.m27.fireMode, 'auto');
});

test('every weapon has ballistics and its assets ship', () => {
  for (const id of WEAPON_IDS) {
    const weapon = WEAPONS[id];
    assert.ok(WEAPON_BALLISTICS[id], `${id} has no ballistics entry`);
    assert.ok(shipped(weapon.viewmodelUrl), `${id} viewmodel missing: ${weapon.viewmodelUrl}`);
    if (weapon.magazineUrl) assert.ok(shipped(weapon.magazineUrl), `${id} magazine missing`);
    for (const [key, url] of Object.entries(weapon.clips)) assert.ok(shipped(url), `${id} clip ${key} missing: ${url}`);
    if (weapon.cardArt) assert.ok(shipped(weapon.cardArt), `${id} card art missing`);
    // Bots carry the rifles; every rifle's world model must be on disk.
    if (weapon.class === 'primary') assert.ok(shipped(weapon.worldModelUrl), `${id} world model missing`);
  }
  for (const pistol of weaponsOfClass('secondary')) {
    assert.ok(pistol.clips.melee, `${pistol.id} needs its pistol-whip clip`);
  }
});

test('melee and grenade specs are knife_mp and the grenade files, with shipped assets', () => {
  assert.equal(MELEE.damage, 150, 'one knife hit kills');
  assert.equal(MELEE.time, 0.8);
  assert.equal(MELEE.delay, 0.125);
  assert.ok(shipped(MELEE.knifeModelUrl));
  assert.ok(shipped(MELEE.clips.swipe));
  assert.ok(shipped(THROW_CLIPS.throw));
  assert.ok(shipped(THROW_CLIPS.pullPin));
  assert.equal(EQUIPMENT.frag.fuse, 3.5);
  assert.equal(EQUIPMENT.frag.explosionRadius, 256);
  assert.equal(EQUIPMENT.frag.innerDamage, 200);
  assert.equal(EQUIPMENT.frag.outerDamage, 75);
  assert.equal(EQUIPMENT.frag.throwSpeed, 920);
  assert.ok(EQUIPMENT.frag.cookable);
  assert.ok(!EQUIPMENT.smoke.cookable);
  assert.ok(shipped(EQUIPMENT.frag.modelUrl));
  assert.ok(shipped(EQUIPMENT.smoke.modelUrl));
  assert.ok(shipped(EQUIPMENT.frag.icon));
  assert.deepEqual(equipmentOfClass('lethal').map((e) => e.id), ['frag']);
  assert.deepEqual(equipmentOfClass('tactical').map((e) => e.id), ['smoke']);
  assert.equal(WEAPON_CLASSES.lethal.key, 'KeyG');
  assert.equal(WEAPON_CLASSES.tactical.key, 'KeyQ');
});

test('lookups accept legacy ids and build soundbank cue names', () => {
  assert.equal(findWeapon('hk416'), WEAPONS.m27);
  assert.equal(findWeapon('M27'), WEAPONS.m27);
  assert.equal(findWeapon('rpg'), null);
  assert.equal(weaponCue('m27', 'dryfire_plr'), 'wpn_hk416_dryfire_plr');
  assert.equal(weaponCue('kard', 'fire_npc'), 'wpn_kard_fire_npc');
});

test('the wheel walks primary to secondary and back, and 1/2 land on the class slots', () => {
  const loadout = { ...DEFAULT_LOADOUT };
  assert.equal(nextHeldWeapon(loadout, 'm27', 1), 'fiveseven');
  assert.equal(nextHeldWeapon(loadout, 'fiveseven', 1), 'm27');
  assert.equal(nextHeldWeapon(loadout, 'm27', -1), 'fiveseven');
  assert.equal(nextHeldWeapon({ primary: 'scar' }, 'scar', 1), 'scar', 'a class with one gun stays on it');
  assert.equal(nextHeldWeapon({}, 'm27'), null);
});

test('random bot loadouts draw a rifle and a pistol and keep both grenades', () => {
  let n = 0;
  const random = () => ((n += 0.37) % 1);
  const seen = new Set();
  for (let i = 0; i < 20; i += 1) {
    const loadout = randomLoadout(random);
    assert.equal(WEAPONS[loadout.primary].class, 'primary');
    assert.equal(WEAPONS[loadout.secondary].class, 'secondary');
    assert.equal(loadout.lethal, 'frag');
    assert.equal(loadout.tactical, 'smoke');
    seen.add(loadout.primary);
  }
  assert.ok(seen.size > 3, 'loadouts vary across bots');
});
