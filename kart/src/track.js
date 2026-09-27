// Track geometry: a closed centripetal Catmull-Rom spline resampled at even
// spacing. Pure math (no three.js) so the simulation and tests can use it.
//
// Coordinates: x/z ground plane in metres, y up. "right" of the direction of
// travel is (-tz, tx); lateral offsets are positive to the right.

import { TRACK } from './config.js';

// Control points (x, z). Driving direction follows the array order.
// Validated by test/track.test.mjs: no self-overlap, min radius, length.
export const CIRCUIT = [
  [-10, 0],
  [40, 0],
  [90, 0],
  [140, 12],
  [172, 48],
  [182, 96],
  [172, 142],
  [160, 168],
  [136, 180],
  [112, 170],
  [102, 146],
  [98, 116],
  [86, 90],
  [62, 80],
  [38, 90],
  [28, 114],
  [24, 150],
  [6, 186],
  [-36, 206],
  [-92, 208],
  [-138, 184],
  [-160, 134],
  [-154, 72],
  [-122, 20],
  [-66, 1],
];

// Boost pads: s is the fraction of the lap, lat the lateral centre (m).
export const BOOST_PADS = [
  { at: 0.065, lat: 0 },
  { at: 0.372, lat: -3 },
  { at: 0.642, lat: 3 },
  { at: 0.8, lat: -2.5 },
];

function catmullRomCentripetal(p0, p1, p2, p3, t) {
  // Barry-Goldman pyramidal formulation with alpha = 0.5.
  const d = (a, b) => Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1]), 0.5) || 1e-4;
  const t0 = 0;
  const t1 = t0 + d(p0, p1);
  const t2 = t1 + d(p1, p2);
  const t3 = t2 + d(p2, p3);
  const tt = t1 + (t2 - t1) * t;
  const lerp = (a, b, ta, tb) => {
    const w = (tt - ta) / (tb - ta);
    return [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w];
  };
  const a1 = lerp(p0, p1, t0, t1);
  const a2 = lerp(p1, p2, t1, t2);
  const a3 = lerp(p2, p3, t2, t3);
  const b1 = lerp(a1, a2, t0, t2);
  const b2 = lerp(a2, a3, t1, t3);
  return lerp(b1, b2, t1, t2);
}

export class Track {
  constructor(points = CIRCUIT, spacing = TRACK.spacing) {
    // 1) Dense polyline along the spline.
    const dense = [];
    const n = points.length;
    const perSeg = 120;
    for (let i = 0; i < n; i++) {
      const p0 = points[(i - 1 + n) % n];
      const p1 = points[i];
      const p2 = points[(i + 1) % n];
      const p3 = points[(i + 2) % n];
      for (let k = 0; k < perSeg; k++) dense.push(catmullRomCentripetal(p0, p1, p2, p3, k / perSeg));
    }
    // 2) Arc length of the dense polyline (closed).
    const cum = [0];
    for (let i = 1; i <= dense.length; i++) {
      const a = dense[i - 1];
      const b = dense[i % dense.length];
      cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
    }
    const total = cum[dense.length];
    // 3) Resample at even spacing.
    const count = Math.max(8, Math.round(total / spacing));
    this.count = count;
    this.length = total;
    this.spacing = total / count;
    this.px = new Float64Array(count);
    this.pz = new Float64Array(count);
    let j = 0;
    for (let i = 0; i < count; i++) {
      const s = i * this.spacing;
      while (cum[j + 1] < s) j++;
      const a = dense[j];
      const b = dense[(j + 1) % dense.length];
      const w = (s - cum[j]) / (cum[j + 1] - cum[j] || 1);
      this.px[i] = a[0] + (b[0] - a[0]) * w;
      this.pz[i] = a[1] + (b[1] - a[1]) * w;
    }
    // 4) Tangents, right normals and signed curvature (positive = turning left).
    this.tx = new Float64Array(count);
    this.tz = new Float64Array(count);
    this.curv = new Float64Array(count);
    for (let i = 0; i < count; i++) {
      const prev = (i - 1 + count) % count;
      const next = (i + 1) % count;
      const dx = this.px[next] - this.px[prev];
      const dz = this.pz[next] - this.pz[prev];
      const len = Math.hypot(dx, dz) || 1;
      this.tx[i] = dx / len;
      this.tz[i] = dz / len;
    }
    // Measured over a few metres so resampling noise doesn't read as sharp kinks.
    const k = Math.max(1, Math.round(4 / this.spacing));
    for (let i = 0; i < count; i++) {
      const prev = (i - k + count) % count;
      const next = (i + k) % count;
      const cross = this.tx[prev] * this.tz[next] - this.tz[prev] * this.tx[next];
      const dot = this.tx[prev] * this.tx[next] + this.tz[prev] * this.tz[next];
      // With x right / z down (seen from above), cross < 0 is a counter-clockwise (left) turn.
      this.curv[i] = -Math.atan2(cross, dot) / (2 * k * this.spacing);
    }
    this.pads = BOOST_PADS.map((p) => ({
      s: p.at * total,
      lat: p.lat,
      halfLen: 4,
      halfWidth: 2.4,
    }));
  }

  wrapS(s) {
    const L = this.length;
    return ((s % L) + L) % L;
  }

  /** Signed shortest distance from a to b along the loop. */
  deltaS(a, b) {
    const L = this.length;
    let d = b - a;
    if (d > L / 2) d -= L;
    if (d < -L / 2) d += L;
    return d;
  }

  index(s) {
    return Math.floor(this.wrapS(s) / this.spacing) % this.count;
  }

  /** Interpolated frame at arc length s, offset `lat` metres to the right. */
  frameAt(s, lat = 0) {
    const ws = this.wrapS(s);
    const f = ws / this.spacing;
    const i = Math.floor(f) % this.count;
    const k = (i + 1) % this.count;
    const w = f - Math.floor(f);
    const tx = this.tx[i] + (this.tx[k] - this.tx[i]) * w;
    const tz = this.tz[i] + (this.tz[k] - this.tz[i]) * w;
    const tl = Math.hypot(tx, tz) || 1;
    const ux = tx / tl;
    const uz = tz / tl;
    const rx = -uz;
    const rz = ux;
    return {
      x: this.px[i] + (this.px[k] - this.px[i]) * w + rx * lat,
      z: this.pz[i] + (this.pz[k] - this.pz[i]) * w + rz * lat,
      tx: ux,
      tz: uz,
      rx,
      rz,
      // Heading angle for an object that faces -Z at heading 0 (three.js convention).
      heading: Math.atan2(-ux, -uz),
      curv: this.curv[i] + (this.curv[k] - this.curv[i]) * w,
    };
  }

  /**
   * Project a world point onto the centerline. `hint` is the sample index from
   * the previous frame; searching near it keeps the answer on the correct part
   * of the circuit and makes the query O(window).
   */
  project(x, z, hint = -1, window = 40) {
    const n = this.count;
    let best = -1;
    let bestD = Infinity;
    if (hint >= 0) {
      for (let o = -window; o <= window; o++) {
        const i = (hint + o + n) % n;
        const dx = x - this.px[i];
        const dz = z - this.pz[i];
        const d = dx * dx + dz * dz;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
    }
    // Fall back to a global search if we have no hint or drifted out of the window.
    if (best < 0 || bestD > 30 * 30) {
      for (let i = 0; i < n; i++) {
        const dx = x - this.px[i];
        const dz = z - this.pz[i];
        const d = dx * dx + dz * dz;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
    }
    // Refine on the better of the two adjacent segments.
    let s = 0;
    let lateral = 0;
    let segBest = Infinity;
    for (const a of [(best - 1 + n) % n, best]) {
      const b = (a + 1) % n;
      const ax = this.px[a];
      const az = this.pz[a];
      const sx = this.px[b] - ax;
      const sz = this.pz[b] - az;
      const segLen2 = sx * sx + sz * sz || 1;
      let t = ((x - ax) * sx + (z - az) * sz) / segLen2;
      t = Math.max(0, Math.min(1, t));
      const cx = ax + sx * t;
      const cz = az + sz * t;
      const d = (x - cx) * (x - cx) + (z - cz) * (z - cz);
      if (d < segBest) {
        segBest = d;
        const len = Math.sqrt(segLen2);
        const ux = sx / len;
        const uz = sz / len;
        // Lateral offset measured along the segment's right normal (-uz, ux).
        lateral = (x - cx) * -uz + (z - cz) * ux;
        s = this.wrapS((a + t) * this.spacing);
      }
    }
    const f = this.frameAt(s);
    return { index: best, s, lateral, rx: f.rx, rz: f.rz, tx: f.tx, tz: f.tz };
  }

  /** Largest |curvature| within [s, s + ahead]. */
  maxCurvatureAhead(s, ahead) {
    const i0 = this.index(s);
    const steps = Math.max(1, Math.round(ahead / this.spacing));
    let m = 0;
    for (let k = 0; k < steps; k++) {
      const c = Math.abs(this.curv[(i0 + k) % this.count]);
      if (c > m) m = c;
    }
    return m;
  }

  /** Brute-force nearest distance from a point to the centerline (for scenery placement). */
  distanceTo(x, z) {
    let best = Infinity;
    for (let i = 0; i < this.count; i += 2) {
      const dx = x - this.px[i];
      const dz = z - this.pz[i];
      const d = dx * dx + dz * dz;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  }

  bounds() {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < this.count; i++) {
      minX = Math.min(minX, this.px[i]);
      maxX = Math.max(maxX, this.px[i]);
      minZ = Math.min(minZ, this.pz[i]);
      maxZ = Math.max(maxZ, this.pz[i]);
    }
    return { minX, maxX, minZ, maxZ };
  }
}
