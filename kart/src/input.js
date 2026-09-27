// Combines the three input sources into one set of driving inputs:
//   tilt      - the accelerometer (steering + horizon-lock roll)
//   touch     - left half of the screen brakes, right half drifts
//   keyboard  - arrows/WASD steer, down/S brakes, space/shift drifts
// The kart always accelerates on its own, like most mobile kart racers, so
// the player's hands stay on the "wheel".

import { STEER } from './config.js';
import { steerInput } from './tilt.js';

const DEG = Math.PI / 180;

export class Controls {
  constructor(tilt, settings) {
    this.tilt = tilt;
    this.settings = settings;
    this.keys = new Set();
    this.brakeTouches = new Set();
    this.driftTouches = new Set();
    this.keySteer = 0;
    // ?sim: the keyboard rotates a virtual iPad, exercising the tilt path
    // (steering + horizon lock) on a desktop browser.
    this.sim = new URLSearchParams(location.search).has('sim');
    const down = (e) => {
      if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
      this.keys.add(e.code);
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].includes(e.code)) e.preventDefault();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.release());
  }

  release() {
    this.keys.clear();
    this.brakeTouches.clear();
    this.driftTouches.clear();
  }

  /** Wire a touch zone element to a pedal. */
  bindZone(el, which, onChange) {
    const set = which === 'brake' ? this.brakeTouches : this.driftTouches;
    const on = (e) => {
      e.preventDefault();
      set.add(e.pointerId);
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      onChange?.(true);
    };
    const off = (e) => {
      set.delete(e.pointerId);
      onChange?.(set.size > 0);
    };
    el.addEventListener('pointerdown', on);
    el.addEventListener('pointerup', off);
    el.addEventListener('pointercancel', off);
    el.addEventListener('lostpointercapture', off);
  }

  key(...codes) {
    return codes.some((c) => this.keys.has(c));
  }

  /**
   * @returns {{ steer, throttle, brake, drift, viewRoll, wheelAngle, source }}
   *   viewRoll   - device rotation to cancel with the camera (0 if lock off)
   *   wheelAngle - how far to turn the on-screen steering wheel
   */
  read(dt) {
    const left = this.key('ArrowLeft', 'KeyA');
    const right = this.key('ArrowRight', 'KeyD');
    const target = (right ? 1 : 0) - (left ? 1 : 0);
    const rate = target === 0 ? 7 : Math.sign(target) !== Math.sign(this.keySteer) ? 9 : 4;
    this.keySteer += Math.max(-rate * dt, Math.min(rate * dt, target - this.keySteer));

    if (this.sim) this.tilt.simRoll = this.keySteer * (this.settings.maxAngle + 4) * DEG;

    const out = {
      steer: 0,
      throttle: 1,
      brake: this.brakeTouches.size > 0 || this.key('ArrowDown', 'KeyS'),
      drift: this.driftTouches.size > 0 || this.key('Space', 'ShiftLeft', 'ShiftRight'),
      viewRoll: 0,
      wheelAngle: 0,
      source: 'none',
    };

    const t = this.tilt.active ? this.tilt.read() : null;
    if (t) {
      out.steer = steerInput(t.steer, this.settings.maxAngle || STEER.defaultMaxAngle);
      out.source = 'tilt';
      if (this.settings.horizonLock) {
        out.viewRoll = t.viewRoll;
        // Turning with the device: the wheel is glued to the screen.
        out.wheelAngle = t.viewRoll;
      } else {
        out.wheelAngle = t.steer;
      }
    }
    if (!this.sim && (target !== 0 || (out.source !== 'tilt' && Math.abs(this.keySteer) > 0.001))) {
      out.steer = this.keySteer;
      out.wheelAngle = this.keySteer * 1.6;
      out.source = 'keys';
    }
    return out;
  }
}
