// Drives the real sensor path with synthetic `devicemotion` events and checks:
//   - turning the device clockwise steers right, anticlockwise steers left
//   - both the iOS gravity sign and the spec (Android) sign work
//   - the horizon, as projected by the live camera, counter-rotates by the
//     device angle, i.e. it stays level with the real world
//   - the camera never pitches
//   - when iPadOS turns the page to portrait mid-race, the race is held in
//     landscape, turned back the way the iPad turned, horizon still level
// Serves the committed build itself (or set KART_URL).   node test/e2e/tilt.mjs
import assert from 'node:assert/strict';
import { chromium, devices } from 'playwright';
import { startDevServer } from '../../tools/dev-server.mjs';

const server = process.env.KART_URL ? null : await startDevServer({ port: 0, host: '127.0.0.1' });
const BASE = process.env.KART_URL || `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
// iPad in landscape: Chromium reports screen.orientation.angle = 90 here.
const ctx = await browser.newContext({ ...devices['iPad Pro 11 landscape'], deviceScaleFactor: 1 });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
await page.goto(BASE);
const angle = await page.evaluate(() => (screen.orientation ? screen.orientation.angle : window.orientation));
console.log(`  emulated screen orientation angle: ${angle}`);

/**
 * Feed accelerationIncludingGravity for a device turned `turnDeg` clockwise
 * (as the player sees it) and tipped back `backDeg`, relative to UI
 * orientation `uiDeg` (default: the current one). sign = +1 spec/Android, -1 iOS.
 */
async function hold(turnDeg, { sign = -1, backDeg = 25, uiDeg = null } = {}) {
  await page.evaluate(
    ({ turnDeg, sign, backDeg, uiDeg }) => {
      const r = Math.PI / 180;
      const ui = (uiDeg ?? ((screen.orientation ? screen.orientation.angle : window.orientation) || 0)) * r;
      const planar = Math.cos(backDeg * r);
      const sx = -Math.sin(turnDeg * r) * planar;
      const sy = Math.cos(turnDeg * r) * planar;
      // UI frame -> device frame.
      const dx = sx * Math.cos(-ui) - sy * Math.sin(-ui);
      const dy = sx * Math.sin(-ui) + sy * Math.cos(-ui);
      const g = 9.81 * sign;
      const e = new DeviceMotionEvent('devicemotion', {
        accelerationIncludingGravity: { x: dx * g, y: dy * g, z: Math.sin(backDeg * r) * g },
        interval: 16,
      });
      // Stream like a real sensor (~60 Hz) until the next pose.
      clearInterval(window.__sensor);
      window.__sensor = setInterval(() => window.dispatchEvent(e), 16);
      for (let i = 0; i < 20; i++) window.dispatchEvent(e);
    },
    { turnDeg, sign, backDeg, uiDeg },
  );
  await frames(2);
}

/** Wait for n animation frames, so the game loop has applied the new state. */
function frames(n) {
  return page.evaluate(
    (n) =>
      new Promise((done) => {
        const tick = () => (--n <= 0 ? done() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }),
    n,
  );
}

/**
 * Where the true horizon lands on screen: project two far-away points at eye
 * height, either side of the view direction, through the live camera.
 * Returns its slope in degrees (positive = rising to the right).
 */
function horizon() {
  return page.evaluate(() => {
    const cam = window.__kart.view.camera;
    cam.updateMatrixWorld();
    // In the canvas's own frame (it is rotated as a whole while the screen is held).
    const W = document.getElementById('scene').clientWidth;
    const H = document.getElementById('scene').clientHeight;
    const screenOf = (yawOffset) => {
      const yaw = cam.rotation.y + yawOffset;
      const p = cam.position.clone();
      p.set(p.x - Math.sin(yaw) * 1000, p.y, p.z - Math.cos(yaw) * 1000).project(cam);
      return [((p.x + 1) / 2) * W, ((1 - p.y) / 2) * H];
    };
    const [xl, yl] = screenOf(0.25);
    const [xr, yr] = screenOf(-0.25);
    return { slopeDeg: (Math.atan2(yl - yr, xr - xl) * 180) / Math.PI, pitch: cam.rotation.x };
  });
}

// Tap a race button to grant motion access (no prompt on Chromium) and start.
await page.click('[data-action=solo]');
await page.waitForFunction(() => window.__kart.race);
await page.evaluate(() => window.__kart.race.pause());

for (const sign of [-1, 1]) {
  const label = sign < 0 ? 'iOS sign' : 'spec sign';
  // Sign detection happens while unlocked (as on the title screen).
  await page.evaluate(() => window.__kart.tilt.unlock());
  await hold(0, { sign });
  await page.evaluate(() => window.__kart.tilt.lock());
  const detected = await page.evaluate(() => window.__kart.tilt.sign);
  assert.equal(detected, sign, `${label}: detected gravity sign`);

  for (const turn of [-20, 0, 20]) {
    await hold(turn, { sign });
    const inp = await page.evaluate(() => window.__kart.controls.read(0));
    const h = await horizon();
    console.log(
      `  ${label} turn ${String(turn).padStart(3)}°: steer ${inp.steer.toFixed(2)}, ` +
        `camera roll ${((-inp.viewRoll * 180) / Math.PI).toFixed(1)}°, horizon on screen ${h.slopeDeg.toFixed(1)}°`,
    );
    assert.equal(h.pitch, 0, 'camera never pitches');
    if (turn === 0) {
      assert.equal(inp.steer, 0);
      assert.ok(Math.abs(h.slopeDeg) < 1.5, 'level device: level horizon');
    } else {
      assert.equal(Math.sign(inp.steer), Math.sign(turn), 'steers toward the turn');
      // On screen the horizon tilts opposite to the device by the same angle,
      // so in the real world it stays level.
      assert.ok(Math.abs(h.slopeDeg - turn) < 3, `horizon counter-rotates ${turn}°, got ${h.slopeDeg.toFixed(1)}°`);
    }
  }
}

// With the lock switched off the view stays fixed to the screen.
await page.evaluate(() => (window.__kart.settings.horizonLock = false));
await hold(20);
await frames(1);
const off = await horizon();
assert.ok(Math.abs(off.slopeDeg) < 1.5, 'lock off: horizon fixed to the screen');
console.log('✓ horizon lock off keeps the view screen-aligned');

await page.evaluate(() => (window.__kart.settings.horizonLock = true));

// iPadOS auto-rotates to portrait mid-corner. The iPad (landscape, angle 90) is
// turned 60° clockwise, so the OS switches to portrait (angle 0).
const cdp = await ctx.newCDPSession(page);
const metrics = (w, h, type, angle) =>
  cdp.send('Emulation.setDeviceMetricsOverride', {
    width: w,
    height: h,
    deviceScaleFactor: 1,
    mobile: true,
    screenOrientation: { type, angle },
  });
const W0 = await page.evaluate(() => innerWidth);
const H0 = await page.evaluate(() => innerHeight);
await page.evaluate(() => window.__kart.tilt.unlock());
await hold(0);
await page.evaluate(() => window.__kart.tilt.lock());
await hold(60, { uiDeg: angle });
await metrics(H0, W0, 'portraitPrimary', 0);
await hold(60, { uiDeg: angle });
await frames(3);
const held = await page.evaluate(() => {
  const b = document.body;
  const c = document.getElementById('scene');
  return {
    hold: b.dataset.hold,
    turn: b.style.getPropertyValue('--hold-turn'),
    portrait: b.dataset.portrait,
    canvas: [c.clientWidth, c.clientHeight],
    viewport: [innerWidth, innerHeight],
    glass: (({ width, height }) => [Math.round(width), Math.round(height)])(c.getBoundingClientRect()),
    steer: window.__kart.controls.read(0).steer,
  };
});
const heldHorizon = await horizon();
console.log(`  held after auto-rotate: ${JSON.stringify(held)}, horizon ${heldHorizon.slopeDeg.toFixed(1)}°`);
assert.equal(held.hold, '1', 'page is held');
assert.equal(held.turn, '90deg', 'turned back clockwise, the way the iPad turned');
assert.equal(held.portrait, '0', 'layout stays landscape');
assert.deepEqual(held.canvas, [W0, H0], 'race still drawn at its landscape size');
assert.deepEqual(held.glass, held.viewport, 'and turned to fill the portrait page');
assert.equal(held.steer, 1, 'steering unaffected: full lock at 60°');
assert.ok(Math.abs(heldHorizon.slopeDeg - 60) < 3, `horizon still level in the world, got ${heldHorizon.slopeDeg}`);
console.log('✓ auto-rotate to portrait mid-race: held in landscape, horizon level');

// Anticlockwise the other way round: rotate back the other way.
await metrics(W0, H0, 'landscapePrimary', angle);
await hold(0, { uiDeg: angle });
await frames(2);
assert.equal(await page.evaluate(() => document.body.dataset.hold), undefined, 'released when the page turns back');
await hold(-60, { uiDeg: angle });
await metrics(H0, W0, 'portraitSecondary', 180);
await hold(-60, { uiDeg: angle });
await frames(3);
const turnBack = await page.evaluate(() => document.body.style.getPropertyValue('--hold-turn'));
assert.equal(turnBack, '-90deg', 'anticlockwise turn is held the other way');
console.log('✓ anticlockwise auto-rotate held the other way');

// After the race, menus follow the device again.
await page.evaluate(() => document.querySelector('[data-action=quit]').click());
await frames(2);
const menu = await page.evaluate(() => [document.body.dataset.screen, document.body.dataset.hold]);
assert.deepEqual(menu, ['title', undefined], 'menus are not held');
console.log('✓ menus follow the device');

await browser.close();
server?.close();
console.log('All tilt checks passed.');
