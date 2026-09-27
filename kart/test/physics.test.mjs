import assert from 'node:assert/strict';
import test from 'node:test';
import { AIDriver } from '../src/ai.js';
import { PHYS, TRACK } from '../src/config.js';
import { Kart, collideKarts } from '../src/kart.js';
import { LapTracker, formatTime, standings } from '../src/race.js';
import { Track } from '../src/track.js';

const track = new Track();
const dt = PHYS.dt;
const GAS = { steer: 0, throttle: 1, brake: false, drift: false };

function run(kart, seconds, inp) {
  for (let t = 0; t < seconds; t += dt) kart.step(dt, typeof inp === 'function' ? inp(t) : inp);
}

test('accelerates to top speed on the straight and no further', () => {
  const k = new Kart(track);
  k.place(0, 0);
  run(k, 1.5, GAS);
  assert.ok(k.speed > 10, `speed after 1.5 s: ${k.speed}`);
  run(k, 3, GAS);
  assert.ok(k.speed <= PHYS.maxSpeed + 0.01 || k.boost > 0, `capped: ${k.speed}`);
  assert.ok(k.dist > 40, 'moved forward along the track');
});

test('positive steer turns right (clockwise seen from above)', () => {
  const k = new Kart(track);
  k.place(0, 0);
  run(k, 1.2, GAS);
  const h0 = k.h;
  run(k, 0.5, { ...GAS, steer: 1 });
  assert.ok(k.h < h0, 'heading decreases = turning right');
  const k2 = new Kart(track);
  k2.place(0, 0);
  run(k2, 1.2, GAS);
  run(k2, 0.5, { ...GAS, steer: -1 });
  assert.ok(k2.h > h0, 'negative steer turns left');
});

test('walls keep the kart inside the barrier', () => {
  const k = new Kart(track);
  k.place(0, 0);
  run(k, 6, { ...GAS, steer: 1 });
  assert.ok(Math.abs(k.lateral) <= TRACK.wallOffset - PHYS.kartRadius + 1e-6, `lateral ${k.lateral}`);
});

test('offroad caps speed', () => {
  const k = new Kart(track);
  k.place(40, 11.5);
  run(k, 3, GAS);
  assert.equal(k.onRoad, false);
  assert.ok(k.speed < PHYS.offroadMaxSpeed + 0.5, `offroad speed ${k.speed}`);
});

test('drift + release fires a mini-turbo', () => {
  const k = new Kart(track);
  k.place(0, -7);
  run(k, 2, GAS);
  k.drainEvents();
  const events = [];
  // Hold a right-hand drift for 0.9 s (away from the walls), then release.
  for (let t = 0; t < 0.9; t += dt) {
    k.step(dt, { steer: 0.5, throttle: 1, brake: false, drift: true });
    events.push(...k.drainEvents());
  }
  assert.ok(!events.includes('wall'), 'test drift stays clear of the barrier');
  assert.equal(k.drift, 1);
  assert.ok(k.driftLevel >= 1);
  k.step(dt, { steer: 0, throttle: 1, brake: false, drift: false });
  events.push(...k.drainEvents());
  assert.ok(events.includes('drift') && events.includes('turbo'), events.join(','));
  assert.ok(k.boost > 0);
});

test('boost pad raises top speed temporarily', () => {
  const k = new Kart(track);
  const pad = track.pads[0];
  k.place(pad.s - 60, pad.lat);
  let peak = 0;
  run(k, 4, (t) => {
    peak = Math.max(peak, k.speed);
    return GAS;
  });
  assert.ok(peak > PHYS.maxSpeed + 2, `peak ${peak}`);
});

test('brake then reverse', () => {
  const k = new Kart(track);
  k.place(0, 0);
  run(k, 2, GAS);
  run(k, 3, { steer: 0, throttle: 1, brake: true, drift: false });
  assert.ok(k.forwardSpeed < -2, `reversing at ${k.forwardSpeed}`);
});

test('kart-kart collision separates and exchanges momentum', () => {
  const a = { x: 0, z: 0, vx: 10, vz: 0 };
  const b = { x: 1.5, z: 0, vx: 0, vz: 0 };
  const hit = collideKarts(a, b, true);
  assert.ok(hit > 0);
  assert.ok(Math.hypot(b.x - a.x, b.z - a.z) >= PHYS.kartRadius * 1.9 - 1e-9);
  assert.ok(b.vx > 0 && a.vx < 10);
});

test('CPU completes three laps in a sensible time without getting stuck', () => {
  const k = new Kart(track);
  k.place(-7, 0);
  const ai = new AIDriver(k);
  const laps = new LapTracker(track.length, 3);
  let t = 0;
  let result = null;
  while (t < 300 && !laps.finished) {
    k.step(dt, ai.think(dt));
    t += dt;
    result = laps.update(k.dist, t) || result;
  }
  assert.equal(result, 'finish');
  const avg = laps.finishTime / 3;
  assert.ok(avg > 35 && avg < 75, `avg lap ${avg.toFixed(1)} s`);
});

test('lap tracker ignores reversing over the line', () => {
  const lt = new LapTracker(1000, 3);
  assert.equal(lt.update(-5, 1), null);
  assert.equal(lt.update(2, 2), null);
  assert.equal(lt.update(1001, 50), 'lap');
  assert.equal(lt.update(995, 51), null);
  assert.equal(lt.update(1002, 52), null);
  assert.equal(lt.completed, 1);
  assert.equal(lt.update(3000, 150), 'finish');
  assert.equal(lt.lapTimes.length, 3);
});

test('standings and time formatting', () => {
  const order = standings([
    { id: 'a', dist: 100, finishTime: null },
    { id: 'b', dist: 500, finishTime: null },
    { id: 'c', dist: 3000, finishTime: 90 },
  ]).map((r) => r.id);
  assert.deepEqual(order, ['c', 'b', 'a']);
  assert.equal(formatTime(83.456), '1:23.46');
  assert.equal(formatTime(59.999), '1:00.00');
});
