import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { WEAPONS } from '../export/web/weapons.js';
import { WEAPON_BALLISTICS } from '../export/web/weapon-ballistics.js';

export async function runAdsTest(page, artifactRoot, { weaponIds = Object.keys(WEAPONS) } = {}) {
  const checks = {}, states = {};
  const state = () => page.evaluate(() => globalThis.hijacked.debug.getState());
  const mobile = (await state()).input.touch.mode;
  const cdp = mobile ? await page.context().newCDPSession(page) : null;
  const check = (name, passed) => { checks[name] = Boolean(passed); assert.ok(passed, name); };
  const shot = async name => {
    states[name] = await state();
    await page.screenshot({ path: path.join(artifactRoot, `ads-${name}.png`) });
    await fs.writeFile(path.join(artifactRoot, 'ads-states.json'), JSON.stringify(states, null, 2));
    return states[name];
  };
  const waitBlend = value => page.waitForFunction(value =>
    globalThis.hijacked.debug.getState().weapon.aimBlend === value, value);
  const aim = async on => {
    if (mobile) {
      const r = await page.locator('[data-touch="aim"]').boundingBox();
      await page.touchscreen.tap(r.x + r.width / 2, r.y + r.height / 2);
    } else if (on) await page.mouse.down({ button: 'right' });
    else await page.mouse.up({ button: 'right' });
  };
  const yaw = forward => Math.atan2(forward[0], -forward[2]);
  const turn = async name => {
    if (!mobile) await page.mouse.move(640, 360);
    await page.evaluate(() => {
      const debug = globalThis.hijacked.debug, eye = debug.getState().player.eye;
      debug.lookAt([eye[0] - 1000, eye[1], eye[2]]);
    });
    const before = await shot(`${name}-start`);
    if (mobile) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 8, x: 460, y: 160 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 8, x: 490, y: 160 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else await page.mouse.move(700, 360);
    const after = await shot(name);
    const delta = yaw(after.player.forward) - yaw(before.player.forward);
    return Math.abs(Math.atan2(Math.sin(delta), Math.cos(delta)));
  };
  await page.evaluate(() => {
    const debug = globalThis.hijacked.debug;
    debug.setEnemiesActive(false); debug.setActive(true); debug.resume();
    debug.setWeaponCamo('erdl');
    globalThis.__adsSamples = [];
    const sample = () => {
      const w = debug.getState().weapon;
      globalThis.__adsSamples.push({ id: w.id, blend: w.aimBlend, fov: w.fov, scale: w.lookSensitivityScale });
      globalThis.__adsSampleFrame = requestAnimationFrame(sample);
    };
    sample();
  });
  if (mobile) await page.waitForFunction(() => globalThis.hijacked.debug.getState().input.touch.enabled);
  try {
    for (const id of weaponIds) {
      process.stdout.write(`ADS: ${id}\n`);
      await page.evaluate(id => globalThis.hijacked.debug.selectWeapon(id), id);
      const hip = await shot(`${id}-hip`);
      check(`${id}Hip`, hip.weapon.fov === 75 && hip.weapon.lookSensitivityScale === 1);
      const hipTurn = WEAPONS[id].scope ? null : await turn(`${id}-hip-turn`);
      await aim(true);
      await shot(`${id}-raising`);
      await waitBlend(1);
      const aimed = await shot(`${id}-aimed`);
      check(`${id}Zoom`, aimed.weapon.fov === WEAPON_BALLISTICS[id].adsZoomFov);
      check(`${id}Overlay`, aimed.weapon.scoped === Boolean(WEAPONS[id].scope));
      if (hipTurn !== null) {
        const adsTurn = await turn(`${id}-ads-turn`);
        const expected = Math.tan(aimed.weapon.fov * Math.PI / 360) / Math.tan(75 * Math.PI / 360);
        check(`${id}Sensitivity`, hipTurn > 0.08 && Math.abs(adsTurn / hipTurn - expected) < 0.025);
      }
      await aim(false);
      await shot(`${id}-lowering`);
      await waitBlend(0);
      check(`${id}RestoresHip`, (await shot(`${id}-lowered`)).weapon.fov === 75);
    }
    // Interruptions must restore zoom immediately, even before another frame.
    await page.evaluate(() => globalThis.hijacked.debug.selectWeapon('m27'));
    await aim(true); await waitBlend(1); await shot('pause-before');
    await page.evaluate(() => globalThis.hijacked.debug.showMenu(true));
    const paused = await shot('paused');
    check('pauseResetsZoom', paused.weapon.fov === 75 && paused.weapon.lookSensitivityScale === 1);
    if (!mobile) await aim(false);
    await page.evaluate(() => { const d = globalThis.hijacked.debug; d.showMenu(false); d.resume(); });
    await aim(true); await waitBlend(1); await shot('switch-before');
    const switched = await page.evaluate(() => {
      const d = globalThis.hijacked.debug; d.selectWeapon('fiveseven'); return d.getState();
    }); // Check before the held aim raises it again.
    check('switchResetsZoom', switched.weapon.fov === 75 && switched.weapon.aimBlend === 0);
    await shot('switched');
    if (!mobile) await aim(false);
    await page.evaluate(() => globalThis.hijacked.debug.respawnPlayer());
    const respawned = await shot('respawned');
    check('respawnResetsZoom', respawned.weapon.fov === 75 && respawned.weapon.aimBlend === 0);
  } finally {
    const samples = await page.evaluate(() => {
      cancelAnimationFrame(globalThis.__adsSampleFrame);
      return globalThis.__adsSamples;
    });
    await fs.writeFile(path.join(artifactRoot, 'ads-transitions.json'), JSON.stringify(samples, null, 2));
    check('worldAndWeaponStayInStep', samples.every(s =>
      Math.abs(s.fov - (75 + (WEAPON_BALLISTICS[s.id].adsZoomFov - 75) * s.blend)) < 0.07));
    check('smoothTransitionObserved', samples.some(s => s.blend > 0 && s.blend < 1));
    await page.evaluate(() => globalThis.hijacked.debug.pause());
  }
  return { checks, states: Object.keys(states) };
}
