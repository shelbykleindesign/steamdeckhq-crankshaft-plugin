import assert from 'node:assert/strict';
import test from 'node:test';
import { TRACK } from '../src/config.js';
import { Track } from '../src/track.js';

const track = new Track();

test('circuit length is a sensible lap', () => {
  assert.ok(track.length > 900 && track.length < 1400, `length ${track.length}`);
});

test('no corner is tighter than the wall offset can follow', () => {
  let maxCurv = 0;
  for (let i = 0; i < track.count; i++) maxCurv = Math.max(maxCurv, Math.abs(track.curv[i]));
  const minR = 1 / maxCurv;
  assert.ok(minR > TRACK.wallOffset + 6, `min radius ${minR.toFixed(1)}`);
});

test('separate parts of the circuit never overlap (walls included)', () => {
  const n = track.count;
  const skip = Math.ceil(80 / track.spacing);
  let minSep = Infinity;
  for (let i = 0; i < n; i += 2) {
    for (let j = 0; j < n; j += 2) {
      const along = Math.min(Math.abs(i - j), n - Math.abs(i - j));
      if (along < skip) continue;
      minSep = Math.min(minSep, Math.hypot(track.px[i] - track.px[j], track.pz[i] - track.pz[j]));
    }
  }
  assert.ok(minSep > 2 * TRACK.wallOffset + 6, `min separation ${minSep.toFixed(1)}`);
});

test('project() recovers s and lateral offset', () => {
  for (const s of [0, 123.4, 500, track.length - 3]) {
    for (const lat of [-7, 0, 5.5]) {
      const f = track.frameAt(s, lat);
      const q = track.project(f.x, f.z, track.index(s));
      assert.ok(Math.abs(track.deltaS(s, q.s)) < 0.6, `s ${s} -> ${q.s}`);
      assert.ok(Math.abs(q.lateral - lat) < 0.3, `lat ${lat} -> ${q.lateral}`);
    }
  }
});

test('lateral is positive to the right of travel', () => {
  const f = track.frameAt(10);
  // Heading 0 faces -Z; right is +X. frameAt gives heading consistent with that.
  const fx = -Math.sin(f.heading);
  const fz = -Math.cos(f.heading);
  assert.ok(Math.abs(fx - f.tx) < 1e-6 && Math.abs(fz - f.tz) < 1e-6);
  const p = track.frameAt(10, 3);
  const q = track.project(p.x, p.z);
  assert.ok(q.lateral > 2.5);
  // Right of (tx, tz) is (-tz, tx).
  assert.ok(Math.abs(p.x - (f.x - f.tz * 3)) < 1e-6);
});

test('curvature sign: positive for left turns', () => {
  // Driving the circuit clockwise on the plan view, most corners are rights.
  let right = 0;
  let left = 0;
  for (let i = 0; i < track.count; i++) {
    if (track.curv[i] < -0.01) right++;
    if (track.curv[i] > 0.01) left++;
  }
  assert.ok(right > left, `rights ${right}, lefts ${left}`);
  assert.ok(left > 0, 'the infield loop has left-handers');
});
