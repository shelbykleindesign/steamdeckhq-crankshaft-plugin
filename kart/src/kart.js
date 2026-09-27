// Arcade kart simulation. Runs at a fixed timestep; no rendering here.
//
// Heading h follows three.js yaw: the kart faces -Z at h = 0 and a positive
// yaw rate turns left (counter-clockwise seen from above).
//   forward = (-sin h, -cos h)     right = (cos h, -sin h)

import { PHYS, TRACK } from './config.js';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export class Kart {
  constructor(track) {
    this.track = track;
    this.reset();
  }

  reset() {
    this.x = 0;
    this.z = 0;
    this.h = 0;
    this.vx = 0;
    this.vz = 0;
    this.yawRate = 0;
    this.steer = 0; // smoothed input, drives the wheel/tyre visuals
    this.drift = 0; // -1 left, 1 right, 0 none
    this.driftTime = 0;
    this.driftLevel = 0;
    this.hopTimer = 0;
    this.hopAnim = 0;
    this.boost = 0;
    this.boostKind = 0; // 1 pad, 2 mini-turbo
    this.idx = -1;
    this.s = 0;
    this.lateral = 0;
    this.onRoad = true;
    this.onPad = false;
    this.dist = 0; // continuous distance along the circuit; laps = floor(dist / length)
    this.wallHit = 0;
    this.wallCooldown = 0;
    this.prevDrift = false;
    this.events = [];
    this.px = 0;
    this.pz = 0;
    this.ph = 0;
  }

  /** Put the kart at arc length s (may be negative = behind the start line). */
  place(s, lateral) {
    this.reset();
    const f = this.track.frameAt(s, lateral);
    this.x = f.x;
    this.z = f.z;
    this.h = f.heading;
    const q = this.track.project(this.x, this.z);
    this.idx = q.index;
    this.s = q.s;
    this.lateral = q.lateral;
    this.dist = this.track.deltaS(0, q.s);
    this.savePrev();
  }

  savePrev() {
    this.px = this.x;
    this.pz = this.z;
    this.ph = this.h;
  }

  get speed() {
    return Math.hypot(this.vx, this.vz);
  }

  get forwardSpeed() {
    return this.vx * -Math.sin(this.h) + this.vz * -Math.cos(this.h);
  }

  /** inp: { steer -1..1 (+ right), throttle 0..1, brake bool, drift bool } */
  step(dt, inp) {
    const P = PHYS;
    this.savePrev();

    let sinH = Math.sin(this.h);
    let cosH = Math.cos(this.h);
    let fx = -sinH;
    let fz = -cosH;
    let rx = cosH;
    let rz = -sinH;
    let vf = this.vx * fx + this.vz * fz;
    let vl = this.vx * rx + this.vz * rz;

    const boosting = this.boost > 0;
    const vmax = boosting ? P.boostMaxSpeed : this.onRoad ? P.maxSpeed : P.offroadMaxSpeed;

    // --- Longitudinal ---
    if (inp.brake) {
      if (vf > 0.5) vf = Math.max(0, vf - P.brakeDecel * dt);
      else vf = Math.max(-P.reverseMaxSpeed, vf - P.reverseAccel * dt);
    } else if (inp.throttle > 0) {
      if (vf < 0) vf = Math.min(0, vf + P.brakeDecel * dt);
      else if (vf < vmax) vf = Math.min(vmax, vf + P.accel * (1 - 0.6 * (vf / vmax)) * inp.throttle * dt);
    } else {
      const d = P.coastDecel * dt;
      vf = Math.abs(vf) <= d ? 0 : vf - Math.sign(vf) * d;
    }
    if (boosting && !inp.brake && vf < vmax) vf = Math.min(vmax, vf + P.boostAccel * dt);
    if (vf > vmax) vf = vmax + (vf - vmax) * Math.exp(-P.overspeedDrag * dt);

    // --- Hop & drift ---
    const pressed = !!inp.drift && !this.prevDrift;
    this.prevDrift = !!inp.drift;
    if (pressed && this.drift === 0 && vf > P.driftMinSpeed) {
      this.hopTimer = P.hopWindow;
      this.hopAnim = 0.28;
      this.events.push('hop');
    }
    if (this.hopTimer > 0) {
      this.hopTimer -= dt;
      if (this.drift === 0 && inp.drift && Math.abs(inp.steer) > 0.25) {
        this.drift = Math.sign(inp.steer);
        this.driftTime = 0;
        this.driftLevel = 0;
        this.hopTimer = 0;
        this.events.push('drift');
      }
    }
    if (this.drift !== 0) {
      if (!inp.drift || vf < P.driftMinSpeed * 0.6) {
        if (!inp.drift && this.driftLevel > 0) {
          this.boost = Math.max(this.boost, P.miniTurbo[this.driftLevel - 1].boost);
          this.boostKind = 2;
          vf += 2;
          this.events.push('turbo');
        } else {
          this.events.push('driftEnd');
        }
        this.drift = 0;
        this.driftTime = 0;
        this.driftLevel = 0;
      } else {
        const into = inp.steer * this.drift;
        this.driftTime += dt * (into > 0.3 ? 1.25 : into < -0.3 ? 0.6 : 1);
        let lvl = 0;
        for (let i = 0; i < P.miniTurbo.length; i++) if (this.driftTime >= P.miniTurbo[i].charge) lvl = i + 1;
        if (lvl !== this.driftLevel) {
          this.driftLevel = lvl;
          this.events.push('spark');
        }
      }
    }

    // --- Yaw ---
    const sp = Math.abs(vf);
    const pedal = inp.throttle > 0 || inp.brake;
    const low = Math.max(pedal ? P.pivotAuthority : 0, Math.min(1, sp / P.steerFullSpeed));
    const high = 1 - P.highSpeedSteerLoss * clamp((sp - 12) / (P.maxSpeed - 12), 0, 1);
    let target;
    if (this.drift !== 0) {
      const k = (clamp(inp.steer * this.drift, -1, 1) + 1) / 2;
      target = -this.drift * (P.driftYawMin + (P.driftYawMax - P.driftYawMin) * k) * low;
    } else {
      target = -inp.steer * P.maxYawRate * low * high * (vf < -0.1 ? -1 : 1);
    }
    this.yawRate += (target - this.yawRate) * (1 - Math.exp(-P.yawResponse * dt));
    this.h += this.yawRate * dt;
    this.steer += (inp.steer - this.steer) * (1 - Math.exp(-14 * dt));

    // The velocity keeps its world direction while the body rotates under it;
    // grip then pulls it back in line, which is what makes the kart slide.
    const wx = fx * vf + rx * vl;
    const wz = fz * vf + rz * vl;
    sinH = Math.sin(this.h);
    cosH = Math.cos(this.h);
    fx = -sinH;
    fz = -cosH;
    rx = cosH;
    rz = -sinH;
    vf = wx * fx + wz * fz;
    vl = wx * rx + wz * rz;
    const grip = this.drift !== 0 ? P.driftGrip : this.onRoad ? P.grip : P.offroadGrip;
    const vl2 = vl * Math.exp(-grip * dt);
    const regained = Math.sqrt(Math.max(0, vf * vf + (vl * vl - vl2 * vl2) * P.gripTransfer));
    vf = vf >= 0 ? regained : -regained;
    vl = vl2;

    this.vx = fx * vf + rx * vl;
    this.vz = fz * vf + rz * vl;
    this.x += this.vx * dt;
    this.z += this.vz * dt;

    if (this.boost > 0) {
      this.boost = Math.max(0, this.boost - dt);
      if (this.boost === 0) this.boostKind = 0;
    }
    if (this.hopAnim > 0) this.hopAnim = Math.max(0, this.hopAnim - dt);
    this.wallHit = Math.max(0, this.wallHit - dt * 20);
    this.wallCooldown = Math.max(0, this.wallCooldown - dt);

    this.collideTrack();
    this.checkPads();
  }

  collideTrack() {
    const tr = this.track;
    const q = tr.project(this.x, this.z, this.idx);
    this.dist += tr.deltaS(this.s, q.s);
    this.s = q.s;
    this.idx = q.index;
    this.lateral = q.lateral;
    const lim = TRACK.wallOffset - PHYS.kartRadius;
    if (Math.abs(q.lateral) > lim) {
      const side = Math.sign(q.lateral);
      const over = Math.abs(q.lateral) - lim;
      const nx = q.rx * side;
      const nz = q.rz * side;
      this.x -= nx * over;
      this.z -= nz * over;
      this.lateral = side * lim;
      const vn = this.vx * nx + this.vz * nz;
      if (vn > 0) {
        this.vx -= (1 + PHYS.wallRestitution) * vn * nx;
        this.vz -= (1 + PHYS.wallRestitution) * vn * nz;
        const loss = Math.min(0.45, vn * 0.03);
        this.vx *= 1 - loss;
        this.vz *= 1 - loss;
        if (vn > 2.5 && this.wallCooldown <= 0) {
          this.wallHit = Math.max(this.wallHit, vn);
          this.wallCooldown = 0.25;
          this.events.push('wall');
          if (vn > 7 && this.drift !== 0) {
            this.drift = 0;
            this.driftTime = 0;
            this.driftLevel = 0;
          }
        }
      }
    }
    this.onRoad = Math.abs(this.lateral) <= TRACK.roadHalfWidth + TRACK.curbWidth * 0.6;
  }

  checkPads() {
    let on = false;
    for (const p of this.track.pads) {
      const d = this.track.deltaS(p.s, this.s);
      if (Math.abs(d) < p.halfLen && Math.abs(this.lateral - p.lat) < p.halfWidth) on = true;
    }
    if (on) {
      if (!this.onPad) this.events.push('pad');
      this.boost = Math.max(this.boost, PHYS.padBoost);
      this.boostKind = Math.max(this.boostKind, 1);
    }
    this.onPad = on;
  }

  /** Pop one-shot events (sounds, HUD flashes) raised since the last call. */
  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }
}

/**
 * Push two overlapping karts apart. `b` may be a remote kart we don't own
 * (moveB = false): only `a` is corrected and gets the whole impulse.
 * Returns the closing speed of the impact (0 if none).
 */
export function collideKarts(a, b, moveB = true) {
  const min = PHYS.kartRadius * 1.9;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const d2 = dx * dx + dz * dz;
  if (d2 >= min * min || d2 < 1e-8) return 0;
  const d = Math.sqrt(d2);
  const nx = dx / d;
  const nz = dz / d;
  const pen = min - d;
  if (moveB) {
    a.x -= (nx * pen) / 2;
    a.z -= (nz * pen) / 2;
    b.x += (nx * pen) / 2;
    b.z += (nz * pen) / 2;
  } else {
    a.x -= nx * pen;
    a.z -= nz * pen;
  }
  const rv = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
  if (rv >= 0) return 0;
  const j = (-(1 + 0.5) * rv) / 2;
  a.vx -= j * nx;
  a.vz -= j * nz;
  if (moveB) {
    b.vx += j * nx;
    b.vz += j * nz;
  }
  return -rv;
}
