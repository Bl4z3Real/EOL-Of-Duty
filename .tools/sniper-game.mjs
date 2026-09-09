import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

// Arrange scenes with the debug API; aim, steady and shoot through real input.
export async function runSniperTest(page, artifactRoot) {
  await page.evaluate(() => globalThis.hijacked.debug.setEnemiesActive(false));
  const checks = {};
  const states = {};
  const mobile = await page.evaluate(() => globalThis.hijacked.debug.getState().input.touch.mode);
  const cdp = mobile ? await page.context().newCDPSession(page) : null;
  const check = (name, passed) => { checks[name] = Boolean(passed); assert.ok(passed, name); };
  const shot = async name => {
    process.stdout.write(`Sniper: ${name}\n`);
    states[name] = await page.evaluate(() => globalThis.hijacked.debug.getState());
    await page.screenshot({ path: path.join(artifactRoot, `sniper-${name}.png`) });
    await fs.writeFile(path.join(artifactRoot, 'sniper-states.json'), JSON.stringify(states, null, 2));
    return states[name];
  };
  const wait = predicate => page.waitForFunction(predicate, null, { timeout: 15000 });
  const tap = async selector => {
    const r = await page.locator(selector).boundingBox();
    assert.ok(r, `${selector} is visible`);
    await page.touchscreen.tap(r.x + r.width / 2, r.y + r.height / 2);
  };
  const aim = async enabled => mobile ? tap('[data-touch="aim"]')
    : enabled ? page.mouse.down({ button: 'right' }) : page.mouse.up({ button: 'right' });
  const fire = async () => {
    if (mobile) return tap('[data-touch="fire"]');
    await page.mouse.down({ button: 'left' });
    await page.waitForTimeout(100);
    await page.mouse.up({ button: 'left' });
  };
  for (const [id, fov, bolt] of [['dsr50', 15, true], ['ballista', 15, true], ['svu', 20, false], ['as50', 15, false]]) {
    await page.evaluate(id => {
      const debug = globalThis.hijacked.debug;
      debug.respawnPlayer();
      debug.selectWeapon(id);
      debug.setActive(true);
      debug.resume();
      const feet = debug.getState().player.feet;
      debug.lookAt([feet[0] + 1000, feet[1] + 100, feet[2]]);
    }, id);
    if (mobile) await wait(() => globalThis.hijacked.debug.getState().input.touch.enabled);
    check(`${id}PhysicalScope`, (await shot(`${id}-hip`)).weapon.scopeMounted);
    await aim(true);
    await wait(() => globalThis.hijacked.debug.getState().weapon.scoped);
    await page.waitForTimeout(400);
    const scoped = await shot(`${id}-scope`);
    check(`${id}Zoom`, Math.abs(scoped.weapon.fov - fov) < 0.1);
    check(`${id}Overlay`, await page.locator('#scope').isVisible() && await page.locator('#scope-lens').evaluate(img => img.complete && img.naturalWidth > 0));
    if (mobile) {
      const r = await page.locator('#touch-breath').boundingBox();
      check(`${id}SteadyTarget`, r && r.width >= 44 && r.height >= 44);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 9, x: r.x + r.width / 2, y: r.y + r.height / 2 }] });
    } else await page.keyboard.down('Shift');
    await wait(() => globalThis.hijacked.debug.getState().weapon.breathHeld);
    check(`${id}HoldBreath`, (await shot(`${id}-steady`)).weapon.breathHeld);
    if (mobile) await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    else await page.keyboard.up('Shift');
    await wait(() => !globalThis.hijacked.debug.getState().weapon.breathHeld);
    await shot(`${id}-breath-release`);
    await fire();
    await wait(() => globalThis.hijacked.debug.getState().weapon.fireCount === 1);
    const fired = await shot(`${id}-shot`);
    check(`${id}Fires`, fired.weapon.magazine === fired.weapon.magazineSize - 1);
    if (bolt) {
      check(`${id}BoltPending`, fired.weapon.pendingRechamber || fired.weapon.rechambering);
      await fire();
      check(`${id}BoltBlocksShot`, (await shot(`${id}-bolt-block`)).weapon.fireCount === 1);
      await wait(() => {
        const w = globalThis.hijacked.debug.getState().weapon;
        return !w.rechambering && !w.pendingRechamber;
      });
      await shot(`${id}-bolt-ready`);
    } else await page.waitForTimeout(500);
    await fire();
    await wait(() => globalThis.hijacked.debug.getState().weapon.fireCount === 2);
    check(`${id}SecondShot`, (await shot(`${id}-second-shot`)).weapon.fireCount === 2);
    await aim(false);
    await wait(() => globalThis.hijacked.debug.getState().weapon.fov === 75);
    check(`${id}Lowered`, !(await shot(`${id}-lowered`)).weapon.scoped);
  }
  if (mobile) {
    await page.setViewportSize({ width: 320, height: 568 });
    await shot('portrait-hip');
    await aim(true);
    await wait(() => globalThis.hijacked.debug.getState().weapon.scoped);
    await shot('portrait-scope');
    check('portraitScopeMask', await page.locator('#scope .scope-cap').evaluateAll(caps => caps.every(cap => cap.getBoundingClientRect().height >= 123)));
    check('portraitSteadyFits', await page.locator('#touch-breath').evaluate(button => {
      const r = button.getBoundingClientRect();
      return r.width >= 44 && r.height >= 44 && r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth;
    }));
  } else {
    await aim(true);
    await wait(() => globalThis.hijacked.debug.getState().weapon.scoped);
    await shot('pause-setup');
  }
  await page.evaluate(() => globalThis.hijacked.debug.showMenu(true));
  const paused = await shot('paused');
  check('pauseResetsScope', !paused.weapon.scoped && paused.weapon.fov === 75 && !paused.weapon.breathHeld);
  if (!mobile) await page.mouse.up({ button: 'right' });
  await page.evaluate(() => {
    globalThis.hijacked.debug.showMenu(false);
    globalThis.hijacked.debug.respawnPlayer();
  });
  const respawned = await shot('respawned');
  check('respawnResetsActions', !respawned.weapon.scoped && !respawned.weapon.rechambering && !respawned.weapon.pendingRechamber && respawned.weapon.magazine === respawned.weapon.magazineSize);
  await page.evaluate(() => globalThis.hijacked.debug.selectWeapon('m27'));
  const rifle = await shot('rifle-restored');
  check('rifleRestoresView', rifle.weapon.id === 'm27' && rifle.weapon.fov === 75 && !rifle.weapon.scoped);
  await page.evaluate(() => {
    globalThis.hijacked.debug.pause();
    globalThis.hijacked.debug.setEnemiesActive(true);
  });
  await shot('final');
  return { checks, states: Object.keys(states) };
}
