import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MAP_CAL, MINIMAP_PING_SIZE, calibrationFromCorners, worldToMinimapUv } from '../export/web/hud.js';

test('minimap uses the authored minimap_corner world bounds', () => {
  assert.deepEqual(MAP_CAL, {
    centerX: -316,
    centerZ: 12,
    size: 7176,
    flipU: 1,
    flipV: -1,
    minimapSpan: 1250,
  });

  // Entity-space corners (3272, 3576) and (-3904, -3600) become
  // Three.js XZ corners (3272, -3576) and (-3904, 3600).
  assert.deepEqual(worldToMinimapUv(3272, -3576), { u: 0, v: 0 });
  assert.deepEqual(worldToMinimapUv(-3904, 3600), { u: 1, v: 1 });
});

test('player spawn projects to its actual location near the bow', () => {
  const uv = worldToMinimapUv(2102, 133);
  assert.ok(Math.abs(uv.u - 0.5168617614269788) < 1e-12);
  assert.ok(Math.abs(uv.v - 0.16304347826086957) < 1e-12);
});

test('calibration derives from minimap_corner entities in either order', () => {
  // Corners as the .ents file lists them, game z-up, in either order.
  const forward = calibrationFromCorners([[3272, 3576, -64], [-3904, -3600, -64]], 1250);
  const reversed = calibrationFromCorners([[-3904, -3600, -64], [3272, 3576, -64]], 1250);
  assert.deepEqual(forward, MAP_CAL);
  assert.deepEqual(reversed, MAP_CAL);

  // A compact square map centred on the origin.
  const small = calibrationFromCorners([[-1200, -1200, 0], [1200, 1200, 0]], 900);
  assert.deepEqual(small, { centerX: 0, centerZ: 0, size: 2400, flipU: 1, flipV: -1, minimapSpan: 900 });
  assert.deepEqual(worldToMinimapUv(0, 0, small), { u: 0.5, v: 0.5 });
  assert.deepEqual(worldToMinimapUv(1200, -1200, small), { u: 0, v: 0 });
});

test('enemy firing pings are five times the original size', () => {
  assert.equal(MINIMAP_PING_SIZE, 80);
});
