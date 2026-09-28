// Accelerometer steering.
//
// The iPad is held like a steering wheel. We read the gravity vector from
// `devicemotion` (accelerationIncludingGravity) and derive one angle: how far
// the device is rotated about its screen normal relative to the real-world
// vertical. That single angle drives two things:
//
//   steering  - relative to how the device was held when the race started
//   view roll - the camera counter-rolls by the same amount, so the rendered
//               horizon stays parallel to the real ground while the device turns
//
// Conventions (all angles radians):
//   device frame: x right, y up, z out of the screen, in the device's natural
//                 (portrait on iPad) orientation
//   screenDeg:    how far the UI is rotated, as reported by screen.orientation
//                 (0, 90, 180, 270)
//   roll > 0:     device turned clockwise as seen by the player = steer right

import { STEER } from './config.js';

const DEG = Math.PI / 180;

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Wrap an angle to (-PI, PI]. */
export function wrapAngle(a) {
  a = (a + Math.PI) % (2 * Math.PI);
  if (a <= 0) a += 2 * Math.PI;
  return a - Math.PI;
}

/** Rotate a device-frame (x, y) vector into the frame of the UI as displayed. */
export function toScreenFrame(x, y, screenDeg) {
  const t = screenDeg * DEG;
  const c = Math.cos(t);
  const s = Math.sin(t);
  return [x * c - y * s, x * s + y * c];
}

/**
 * Analyse a world-up vector expressed in device coordinates.
 *   roll   - clockwise rotation of the device about its screen normal
 *   planar - share of gravity lying in the screen plane (1 upright, 0 flat)
 *   tray   - steering angle that still works when the device is held flat
 */
export function analyzeUp(ux, uy, uz, screenDeg) {
  const [sx, sy] = toScreenFrame(ux, uy, screenDeg);
  const mag = Math.hypot(ux, uy, uz) || 1;
  return {
    roll: Math.atan2(-sx, sy),
    planar: Math.hypot(sx, sy) / mag,
    tray: Math.asin(clamp(-sx / mag, -1, 1)),
  };
}

/**
 * Steering angle from an analysis. Upright, the exact wheel angle is used;
 * as the device is tipped back toward flat the wheel angle becomes unstable,
 * so we blend to the tray-style angle which degrades gracefully.
 */
export function steerAngle(a) {
  const w = smoothstep(0.15, 0.35, a.planar);
  return w * a.roll + (1 - w) * a.tray;
}

/** Camera counter-roll weight: fade out when the device is nearly flat. */
export function horizonWeight(a) {
  return smoothstep(0.12, 0.3, a.planar);
}

/**
 * The spec says accelerationIncludingGravity points *up* at rest (+9.81 on z
 * when flat on a table). iOS Safari reports the opposite sign. Work out which
 * one this device uses from a sample taken while the player is looking at the
 * screen (so the UI's "up" is roughly world-up). Returns +1, -1 or 0 (unsure).
 */
export function detectGravitySign(ax, ay, az, screenDeg) {
  const mag = Math.hypot(ax, ay, az);
  if (!(mag > 5 && mag < 15)) return 0; // shaking or no data
  const [, sy] = toScreenFrame(ax, ay, screenDeg);
  if (sy > 0.35 * mag) return 1;
  if (sy < -0.35 * mag) return -1;
  // Held nearly flat: assume the screen faces up.
  if (az > 0.8 * mag) return 1;
  if (az < -0.8 * mag) return -1;
  return 0;
}

/** Map a steering angle to a -1..1 input using the player's sensitivity. */
export function steerInput(angle, maxAngleDeg = STEER.defaultMaxAngle) {
  const dz = STEER.deadzone * DEG;
  const max = maxAngleDeg * DEG;
  const mag = Math.abs(angle) - dz;
  if (mag <= 0) return 0;
  const x = Math.min(1, mag / (max - dz));
  return Math.sign(angle) * Math.pow(x, STEER.curve);
}

/**
 * UI rotation in degrees (0, 90, 180, 270). iPadOS before 16.4 in Safari's
 * default desktop mode exposes neither API, so fall back to the viewport's
 * shape: which landscape we pick doesn't matter, because a 180° error is
 * absorbed by detectGravitySign.
 */
export function currentScreenDeg(env = globalThis) {
  const o = env.screen ? env.screen.orientation : null;
  let a;
  if (o && typeof o.angle === 'number') a = o.angle;
  else if (typeof env.orientation === 'number') a = env.orientation;
  else if (env.innerWidth && env.innerHeight) a = env.innerWidth > env.innerHeight ? 90 : 0;
  else a = 0;
  a = ((a % 360) + 360) % 360;
  // Some iPads report angle 0 while the page is landscape (and 90 in portrait).
  // Trust the page's shape for portrait vs landscape; a leftover 180° error is
  // absorbed by detectGravitySign.
  if (env.innerWidth && env.innerHeight && env.innerWidth !== env.innerHeight) {
    const landscape = env.innerWidth > env.innerHeight;
    if (landscape === (a % 180 === 0)) a = (a + 90) % 360;
  }
  return a;
}

function isAppleTouch() {
  if (typeof navigator === 'undefined') return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

export class TiltInput {
  constructor() {
    this.permission = 'unknown'; // unknown | granted | denied | unsupported
    this.g = null; // low-passed accelerationIncludingGravity [x, y, z]
    this.lastEvent = 0;
    this.sign = isAppleTouch() ? -1 : 1;
    this.signLocked = false;
    this.refDeg = currentScreenDeg();
    this.center = 0; // player-chosen neutral (radians)
    this.held = false; // set while hold.js keeps the page in the race's orientation
    this.listening = false;
    this._onMotion = this._onMotion.bind(this);
    // Test hook: a fixed simulated roll (radians) overrides the sensor.
    this.simRoll = null;
  }

  get supported() {
    return typeof window !== 'undefined' && 'DeviceMotionEvent' in window;
  }

  get needsPermission() {
    return this.supported && typeof DeviceMotionEvent.requestPermission === 'function';
  }

  /** True once real sensor data has arrived recently. */
  get active() {
    return this.simRoll !== null || (this.g !== null && performance.now() - this.lastEvent < 1000);
  }

  /**
   * Must be called synchronously inside a user gesture on iOS.
   * Resolves to the permission state.
   */
  request() {
    if (!this.supported) {
      this.permission = 'unsupported';
      return Promise.resolve(this.permission);
    }
    if (!this.needsPermission) {
      this.permission = 'granted';
      this.listen();
      return Promise.resolve(this.permission);
    }
    if (this.permission === 'granted') return Promise.resolve('granted');
    return DeviceMotionEvent.requestPermission()
      .then((res) => {
        this.permission = res === 'granted' ? 'granted' : 'denied';
        if (this.permission === 'granted') this.listen();
        return this.permission;
      })
      .catch(() => {
        // Thrown when not called from a gesture; leave it retryable.
        this.permission = 'unknown';
        return this.permission;
      });
  }

  listen() {
    if (this.listening || !this.supported) return;
    this.listening = true;
    window.addEventListener('devicemotion', this._onMotion);
  }

  _onMotion(e) {
    const a = e.accelerationIncludingGravity;
    if (!a || a.x === null || a.y === null || a.z === null) return;
    const now = performance.now();
    const dt = this.lastEvent ? Math.min(0.1, (now - this.lastEvent) / 1000) : 0;
    this.lastEvent = now;
    if (!this.g) {
      this.g = [a.x, a.y, a.z];
    } else {
      const k = dt > 0 ? 1 - Math.exp(-dt / STEER.filterTau) : 1;
      this.g[0] += (a.x - this.g[0]) * k;
      this.g[1] += (a.y - this.g[1]) * k;
      this.g[2] += (a.z - this.g[2]) * k;
    }
    if (!this.signLocked) {
      const s = detectGravitySign(this.g[0], this.g[1], this.g[2], currentScreenDeg());
      if (s) this.sign = s;
    }
  }

  /**
   * Freeze the sign and the reference orientation for a race, so an accidental
   * iOS auto-rotate mid-corner doesn't flip the steering.
   */
  lock() {
    this.refDeg = currentScreenDeg();
    this.signLocked = true;
  }

  unlock() {
    this.signLocked = false;
    this.refDeg = currentScreenDeg();
  }

  /** Make the current hold the neutral steering position. */
  recenter() {
    const r = this.read();
    if (r) this.center = wrapAngle(this.center + r.steer);
  }

  resetCenter() {
    this.center = 0;
  }

  /**
   * Returns { steer, viewRoll } in radians or null without data.
   *   steer    - rotation relative to the race reference orientation and centre
   *   viewRoll - device rotation relative to the *current* UI orientation,
   *              faded out when flat; the camera rolls by -viewRoll
   */
  read() {
    if (this.simRoll !== null) return { steer: this.simRoll - this.center, viewRoll: this.simRoll, planar: 1 };
    if (!this.g) return null;
    const s = this.sign;
    const ux = this.g[0] * s;
    const uy = this.g[1] * s;
    const uz = this.g[2] * s;
    // While a race holds the page against an iPadOS auto-rotate (hold.js), the
    // view is still drawn in the race's orientation.
    const nowDeg = this.held ? this.refDeg : currentScreenDeg();
    if (!this.signLocked) this.refDeg = nowDeg;
    // A deliberate 180° flip of the device mid-race: follow it. (A 90° change is
    // iOS auto-rotating during a hard turn, which must not move the reference.)
    if ((((nowDeg - this.refDeg) % 360) + 360) % 360 === 180) this.refDeg = nowDeg;
    const ref = analyzeUp(ux, uy, uz, this.refDeg);
    const cur = nowDeg === this.refDeg ? ref : analyzeUp(ux, uy, uz, nowDeg);
    return {
      steer: wrapAngle(steerAngle(ref) - this.center),
      viewRoll: cur.roll * horizonWeight(cur),
      planar: cur.planar,
    };
  }
}
