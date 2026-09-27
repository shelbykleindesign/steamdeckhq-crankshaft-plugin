import assert from 'node:assert/strict';
import test from 'node:test';
import {
  analyzeUp,
  currentScreenDeg,
  detectGravitySign,
  steerAngle,
  steerInput,
  toScreenFrame,
  wrapAngle,
} from '../src/tilt.js';

const G = 9.81;
const DEG = Math.PI / 180;

/**
 * World-up in device coordinates for a device whose UI is rotated `screenDeg`
 * (CCW device rotation), then turned clockwise by `turnDeg` like a wheel and
 * tipped back by `backDeg` from vertical.
 */
function upVector(screenDeg, turnDeg, backDeg = 0) {
  const planar = Math.cos(backDeg * DEG);
  // In the UI frame, world-up leans opposite to a clockwise turn.
  const sx = -Math.sin(turnDeg * DEG) * planar;
  const sy = Math.cos(turnDeg * DEG) * planar;
  // UI frame -> device frame is the inverse rotation.
  const [dx, dy] = toScreenFrame(sx, sy, -screenDeg);
  return [dx * G, dy * G, Math.sin(backDeg * DEG) * G];
}

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('wrapAngle keeps angles in (-PI, PI]', () => {
  close(wrapAngle(0), 0);
  close(wrapAngle(Math.PI), Math.PI);
  close(wrapAngle(-Math.PI), Math.PI);
  close(wrapAngle(3 * Math.PI), Math.PI);
  close(wrapAngle(-0.5 - 2 * Math.PI), -0.5);
});

test('upright device reads zero roll in every UI orientation', () => {
  for (const deg of [0, 90, 180, 270]) {
    const [x, y, z] = upVector(deg, 0);
    close(analyzeUp(x, y, z, deg).roll, 0);
  }
});

test('landscape (home button right): up vector lies along device +x', () => {
  const [x, y] = upVector(90, 0);
  close(x, G);
  close(y, 0);
});

test('clockwise turn gives positive roll in both landscapes and portrait', () => {
  for (const deg of [0, 90, 270]) {
    for (const turn of [-30, -10, 10, 25]) {
      const [x, y, z] = upVector(deg, turn);
      close(analyzeUp(x, y, z, deg).roll, turn * DEG);
    }
  }
});

test('roll is independent of how far the device is tipped back', () => {
  for (const back of [0, 30, 55, 68]) {
    const [x, y, z] = upVector(90, 20, back);
    close(analyzeUp(x, y, z, 90).roll, 20 * DEG);
    close(steerAngle(analyzeUp(x, y, z, 90)), 20 * DEG);
  }
});

test('nearly flat device still steers in the right direction', () => {
  const [x, y, z] = upVector(90, 20, 85);
  const a = analyzeUp(x, y, z, 90);
  assert.ok(a.planar < 0.1);
  assert.ok(steerAngle(a) > 0, 'right turn stays positive');
  const [x2, y2, z2] = upVector(90, -20, 85);
  assert.ok(steerAngle(analyzeUp(x2, y2, z2, 90)) < 0, 'left turn stays negative');
});

test('gravity sign detection: spec (Android) vs inverted (iOS)', () => {
  for (const deg of [0, 90, 270]) {
    const [x, y, z] = upVector(deg, 5, 30);
    assert.equal(detectGravitySign(x, y, z, deg), 1);
    assert.equal(detectGravitySign(-x, -y, -z, deg), -1);
  }
  // Flat on a table, screen up.
  assert.equal(detectGravitySign(0, 0, G, 90), 1);
  assert.equal(detectGravitySign(0, 0, -G, 90), -1);
  // Shaking: no decision.
  assert.equal(detectGravitySign(0, 30, 0, 0), 0);
});

test('an orientation angle reported 180° off is absorbed by the sign detection', () => {
  // Platform says 270 while the device is really at 90.
  const [x, y, z] = upVector(90, 15, 20);
  const sign = detectGravitySign(x, y, z, 270);
  assert.equal(sign, -1);
  close(analyzeUp(x * sign, y * sign, z * sign, 270).roll, 15 * DEG);
});

test('steerInput: deadzone, saturation, symmetry', () => {
  assert.equal(steerInput(1 * DEG, 28), 0);
  assert.equal(steerInput(40 * DEG, 28), 1);
  assert.equal(steerInput(-40 * DEG, 28), -1);
  const a = steerInput(14 * DEG, 28);
  assert.ok(a > 0.3 && a < 0.6, `half lock ~0.45, got ${a}`);
  close(steerInput(-14 * DEG, 28), -a);
});

test('screen angle: modern API, legacy API, and aspect-ratio fallback', () => {
  assert.equal(currentScreenDeg({ screen: { orientation: { angle: 270 } } }), 270);
  assert.equal(currentScreenDeg({ screen: {}, orientation: -90 }), 270);
  // iPadOS < 16.4 in desktop mode: no orientation API at all.
  assert.equal(currentScreenDeg({ screen: {}, innerWidth: 1180, innerHeight: 820 }), 90);
  assert.equal(currentScreenDeg({ screen: {}, innerWidth: 820, innerHeight: 1180 }), 0);
  assert.equal(currentScreenDeg({}), 0);
});
