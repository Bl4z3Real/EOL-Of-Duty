import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  WEAPON_CAMOS, WEAPON_CAMO_IDS, DEFAULT_WEAPON_CAMO, PLAYER_SKINS, PLAYER_SKIN_IDS, SKINNABLE_TEXTURE_PATTERN,
  findCamo, nextCamo, findSkin, randomPick, dealSkins,
} from '../export/web/skins.js';

test('the camo catalog keeps the project camos first and the game camos behind them', () => {
  assert.equal(DEFAULT_WEAPON_CAMO, 'openai');
  assert.deepEqual(WEAPON_CAMO_IDS.slice(0, 2), ['openai', 'claude']);
  assert.ok(WEAPON_CAMO_IDS.includes('kryptek_typhon'));
  assert.ok(WEAPON_CAMO_IDS.includes('tiger_blue'));
  assert.equal(new Set(WEAPON_CAMO_IDS).size, WEAPON_CAMO_IDS.length, 'camo ids are unique');
  for (const camo of WEAPON_CAMOS) {
    assert.match(camo.url, /^\.\/images\/.*\.webp$/);
    assert.ok(camo.repeat >= 1);
    assert.ok(camo.name);
  }
  assert.equal(findCamo('erdl').name, 'ERDL');
  assert.equal(findCamo('woodland'), null);
});

test('cycling camos wraps in both directions', () => {
  const ids = ['a', 'b', 'c'];
  assert.equal(nextCamo('a', 1, ids), 'b');
  assert.equal(nextCamo('c', 1, ids), 'a');
  assert.equal(nextCamo('a', -1, ids), 'c');
  assert.equal(nextCamo('missing', 1, ids), 'b', 'an unknown current camo counts as the first');
  assert.equal(nextCamo('a', 1, []), null);
});

test('operator skins recolour the clothing textures and nothing else', () => {
  assert.ok(PLAYER_SKINS.length >= 4);
  assert.equal(PLAYER_SKINS[0].id, 'pla_assault', 'the shipped look stays the first skin');
  assert.equal(findSkin('pla_desert').tint.length, 3);
  assert.ok(SKINNABLE_TEXTURE_PATTERN.test('c_chn_mp_pla_upper1_vest_c'));
  assert.ok(SKINNABLE_TEXTURE_PATTERN.test('c_chn_mp_pla_gear_smg_assault_c.png'));
  assert.ok(!SKINNABLE_TEXTURE_PATTERN.test('c_chn_mp_pla_head_c'), 'skin tones stay put');
  assert.ok(!SKINNABLE_TEXTURE_PATTERN.test('c_chn_mp_pla_glove1_c'));
  assert.ok(!SKINNABLE_TEXTURE_PATTERN.test('c_chn_mp_pla_upper1_vest_n'), 'normal maps are never recoloured');
});

test('dealing skins spreads the catalog across the squad and repeats only when it must', () => {
  let n = 0;
  const random = () => ((n += 0.61) % 1);
  const six = dealSkins(6, random);
  assert.equal(six.length, 6);
  assert.equal(new Set(six).size, Math.min(6, PLAYER_SKIN_IDS.length), 'no skin repeats before the catalog is used up');
  for (const id of six) assert.ok(PLAYER_SKIN_IDS.includes(id));
  const many = dealSkins(PLAYER_SKIN_IDS.length + 3, random);
  assert.equal(many.length, PLAYER_SKIN_IDS.length + 3);
  assert.deepEqual(dealSkins(0, random), []);
});

test('randomPick stays inside the list', () => {
  assert.equal(randomPick(['x'], () => 0.999), 'x');
  assert.equal(randomPick(['x', 'y'], () => 0), 'x');
  assert.equal(randomPick(['x', 'y'], () => 0.5), 'y');
  assert.equal(randomPick([], Math.random), null);
});
