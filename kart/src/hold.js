// Keeps a race on screen the way it started. Unless Rotation Lock is on, iPadOS
// turns the page to portrait once the iPad is turned past about 45°, and a hard
// corner gets there. While a race holds, a page turned by 90° is rotated back,
// so the game stays fixed to the glass and the steering math keeps its frame.
// (A 180° flip is the player turning the iPad round on purpose: left alone.)
//
// The direction comes from the tilt reading, not the orientation APIs: which
// way screen.orientation.angle counts has changed between iOS versions.

export class ScreenHold {
  /**
   * turnSign: () => +1 if the device is turned clockwise from the race's
   *           orientation, -1 anticlockwise, 0 unknown
   * onChange: (turn, changed) => void, after the page is rotated or released
   */
  constructor({ turnSign, onChange }) {
    this.turnSign = turnSign;
    this.onChange = onChange;
    this.active = false;
    this.landscape = false; // the page's shape when the hold began
    this.startDeg = 0;
    this.turn = 0; // degrees the page is rotated back: 0, 90 or -90
    const update = () => this.update();
    addEventListener('resize', update);
    if (window.visualViewport) visualViewport.addEventListener('resize', update);
    if (screen.orientation && screen.orientation.addEventListener)
      screen.orientation.addEventListener('change', update);
  }

  set(on) {
    if (on === this.active) return;
    this.active = on;
    this.landscape = innerWidth > innerHeight;
    this.startDeg = legacyDeg();
    this.update();
  }

  update() {
    let turn = 0;
    if (this.active && innerWidth > innerHeight !== this.landscape) {
      // Keep the first direction until the page turns back.
      turn = this.turn || this.direction();
    }
    const changed = turn !== this.turn;
    this.turn = turn;
    const body = document.body;
    if (turn) {
      body.dataset.hold = '1';
      body.style.setProperty('--hold-w', `${innerHeight}px`);
      body.style.setProperty('--hold-h', `${innerWidth}px`);
      body.style.setProperty('--hold-turn', `${turn}deg`);
    } else {
      delete body.dataset.hold;
    }
    if (changed || turn) this.onChange(turn, changed);
  }

  /** Rotate the page the way the iPad turned, undoing iPadOS's correction. */
  direction() {
    const sign = this.turnSign();
    if (sign) return sign > 0 ? 90 : -90;
    // No tilt reading: fall back on window.orientation, whose counterclockwise
    // convention has stayed put.
    const d = (((this.startDeg - legacyDeg()) % 360) + 360) % 360;
    return d === 270 ? -90 : 90;
  }
}

function legacyDeg() {
  if (typeof window.orientation === 'number') return window.orientation;
  return screen.orientation ? screen.orientation.angle : 0;
}
