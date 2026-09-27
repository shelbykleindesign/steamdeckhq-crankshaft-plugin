// CPU rival for solo races. Produces the same inputs a player would, so it
// drives with the exact physics the player has.

import { PHYS } from './config.js';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export class AIDriver {
  constructor(kart, { pace = 1 } = {}) {
    this.kart = kart;
    this.pace = pace;
    this.line = 0; // current lateral target, eased toward the racing line
    this.t = Math.random() * 100;
    this.stuck = 0;
    this.reverse = 0;
  }

  /** ctx.rivalDist: progress of the player, for gentle rubber-banding. */
  think(dt, ctx = {}) {
    const k = this.kart;
    const tr = k.track;
    this.t += dt;
    const speed = k.speed;

    // Take the inside of upcoming corners, with a little weave so it looks human.
    const ahead = tr.frameAt(k.s + 18 + speed * 0.8);
    const want = clamp(-ahead.curv * 260, -4.5, 4.5) + Math.sin(this.t * 0.37) * 1.2;
    this.line += (want - this.line) * (1 - Math.exp(-1.2 * dt));

    const look = 7 + speed * 0.5;
    const target = tr.frameAt(k.s + look, this.line);
    const dx = target.x - k.x;
    const dz = target.z - k.z;
    const sinH = Math.sin(k.h);
    const cosH = Math.cos(k.h);
    const fwd = dx * -sinH + dz * -cosH;
    const right = dx * cosH + dz * -sinH;
    const angle = Math.atan2(right, fwd);
    let steer = clamp(angle * 2.4, -1, 1);

    // Keep it close: ease off when far ahead, push when far behind.
    let pace = this.pace;
    if (ctx.rivalDist !== undefined) {
      const gap = k.dist - ctx.rivalDist;
      pace *= clamp(1 - gap / 900, 0.86, 1.06);
    }
    const curv = tr.maxCurvatureAhead(k.s, 10 + speed * 1.4);
    const cornerSpeed = Math.sqrt(26 / Math.max(curv, 1e-4));
    const vTarget = Math.min(PHYS.maxSpeed * pace, cornerSpeed);

    // Pointed the wrong way: full lock toward the target.
    if (Math.abs(angle) > 1.9) steer = Math.sign(angle);

    // Stuck nose-first in a wall: back out with opposite lock.
    this.stuck = speed < 1.5 ? this.stuck + dt : 0;
    if (this.stuck > 1) this.reverse = 0.9;
    if (this.reverse > 0) {
      this.reverse -= dt;
      this.stuck = 0;
      return { steer: -steer, throttle: 0, brake: true, drift: false };
    }

    return {
      steer,
      throttle: speed < vTarget ? 1 : 0,
      brake: speed > vTarget + 3,
      drift: false,
    };
  }
}
