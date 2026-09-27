// Drives the real sensor path with synthetic `devicemotion` events and checks:
//   - turning the device clockwise steers right, anticlockwise steers left
//   - both the iOS gravity sign and the spec (Android) sign work
//   - the horizon, as projected by the live camera, counter-rotates by the
//     device angle, i.e. it stays level with the real world
//   - the camera never pitches
// Needs `npx http-server docs -p 8080` running.   node test/e2e/tilt.mjs
import assert from 'node:assert/strict';
import { chromium, devices } from 'playwright';

const BASE = process.env.KART_URL || 'http://localhost:8080/';
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
 * (as the player sees it) and tipped back `backDeg`, in the current UI
 * orientation. sign = +1 spec/Android, -1 iOS.
 */
async function hold(turnDeg, { sign = -1, backDeg = 25 } = {}) {
  await page.evaluate(
    ({ turnDeg, sign, backDeg }) => {
      const r = Math.PI / 180;
      const ui = ((screen.orientation ? screen.orientation.angle : window.orientation) || 0) * r;
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
    { turnDeg, sign, backDeg },
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
    const W = innerWidth;
    const H = innerHeight;
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

await browser.close();
console.log('All tilt checks passed.');
