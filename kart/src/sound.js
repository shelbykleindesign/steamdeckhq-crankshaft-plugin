// Synthesised audio (no sample files): engine buzz, skid, boost and UI cues.

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export class Sound {
  constructor(enabled = true) {
    this.enabled = enabled;
    this.ctx = null;
  }

  /** Create/resume the AudioContext. Call from a user gesture (iOS). */
  unlock() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!this.ctx) {
      this.ctx = new AC();
      this.build();
    }
    // iOS uses 'interrupted' after a call or backgrounding.
    if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.setTargetAtTime(on ? 0.8 : 0, this.ctx.currentTime, 0.05);
  }

  build() {
    const c = this.ctx;
    this.comp = c.createDynamicsCompressor();
    this.comp.connect(c.destination);
    this.master = c.createGain();
    this.master.gain.value = this.enabled ? 0.8 : 0;
    this.master.connect(this.comp);

    const len = c.sampleRate;
    this.noise = c.createBuffer(1, len, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    this.engine = this.engineVoice();
    this.rival = this.engineVoice();

    // Tyre skid: looping noise through a band-pass.
    const src = c.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    this.skidFilter = c.createBiquadFilter();
    this.skidFilter.type = 'bandpass';
    this.skidFilter.frequency.value = 1400;
    this.skidFilter.Q.value = 2.5;
    this.skidGain = c.createGain();
    this.skidGain.gain.value = 0;
    src.connect(this.skidFilter).connect(this.skidGain).connect(this.master);
    src.start();
  }

  engineVoice() {
    const c = this.ctx;
    const o1 = c.createOscillator();
    const o2 = c.createOscillator();
    o1.type = 'sawtooth';
    o2.type = 'square';
    const sub = c.createGain();
    sub.gain.value = 0.45;
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 3;
    const gain = c.createGain();
    gain.gain.value = 0;
    o1.connect(filter);
    o2.connect(sub).connect(filter);
    filter.connect(gain);
    let pan = null;
    if (c.createStereoPanner) {
      pan = c.createStereoPanner();
      gain.connect(pan).connect(this.master);
    } else {
      gain.connect(this.master);
    }
    o1.start();
    o2.start();
    return { o1, o2, filter, gain, pan };
  }

  setEngine(v, speedRatio, throttle, vol, pan = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const f = 42 + speedRatio * 150;
    v.o1.frequency.setTargetAtTime(f, t, 0.05);
    v.o2.frequency.setTargetAtTime(f * 0.5 + 1.5, t, 0.05);
    v.filter.frequency.setTargetAtTime(300 + speedRatio * 1900 + throttle * 500, t, 0.05);
    v.gain.gain.setTargetAtTime(vol, t, 0.08);
    if (v.pan) v.pan.pan.setTargetAtTime(clamp(pan, -1, 1), t, 0.05);
  }

  /**
   * Per-frame update. s: { active, speed, maxSpeed, throttle, skid,
   *   rival: { dist, speed, pan } | null }
   */
  update(s) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    // 20 Hz is plenty for engine pitch and keeps the automation timeline short.
    if (t - (this.lastUpdate || 0) < 0.05 && s.active === this.lastActive) return;
    this.lastUpdate = t;
    this.lastActive = s.active;
    if (!s.active) {
      this.setEngine(this.engine, 0, 0, 0);
      this.setEngine(this.rival, 0, 0, 0);
      this.skidGain.gain.setTargetAtTime(0, t, 0.05);
      return;
    }
    const ratio = clamp(s.speed / s.maxSpeed, 0, 1.4);
    this.setEngine(this.engine, ratio, s.throttle, 0.1 + s.throttle * 0.05);
    this.skidGain.gain.setTargetAtTime(clamp(s.skid, 0, 1) * 0.16, t, 0.04);
    this.skidFilter.frequency.setTargetAtTime(900 + ratio * 900, t, 0.1);
    if (s.rival) {
      const near = clamp(1 - s.rival.dist / 70, 0, 1);
      this.setEngine(this.rival, clamp(s.rival.speed / s.maxSpeed, 0, 1.4), 1, near * near * 0.09, s.rival.pan);
    } else {
      this.setEngine(this.rival, 0, 0, 0);
    }
  }

  tone(freq, dur, { type = 'sine', vol = 0.25, at = 0, slide = 0 } = {}) {
    if (!this.ctx) return;
    const c = this.ctx;
    const t = c.currentTime + at;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  noiseBurst(dur, { type = 'lowpass', freq = 400, to = null, vol = 0.4, q = 0.7 } = {}) {
    if (!this.ctx) return;
    const c = this.ctx;
    const t = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  countdown(n) {
    if (n > 0) this.tone(523, 0.2, { type: 'square', vol: 0.12 });
    else this.tone(1046, 0.6, { type: 'square', vol: 0.14 });
  }

  boost() {
    this.noiseBurst(0.7, { type: 'bandpass', freq: 500, to: 3500, vol: 0.5, q: 1.2 });
    this.tone(220, 0.5, { type: 'sawtooth', vol: 0.06, slide: 3 });
  }

  spark(level) {
    this.tone([1100, 1400, 1800][level - 1] || 1100, 0.08, { type: 'triangle', vol: 0.12 });
  }

  hop() {
    this.tone(300, 0.12, { type: 'triangle', vol: 0.08, slide: 1.8 });
  }

  wall(strength) {
    const v = clamp(strength / 12, 0.1, 1);
    this.noiseBurst(0.22, { freq: 260, vol: 0.6 * v });
    this.tone(90, 0.2, { vol: 0.3 * v, slide: 0.5 });
  }

  lap() {
    this.tone(784, 0.14, { type: 'triangle', vol: 0.16 });
    this.tone(1175, 0.3, { type: 'triangle', vol: 0.16, at: 0.12 });
  }

  finish() {
    [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.35, { type: 'square', vol: 0.09, at: i * 0.12 }));
  }

  click() {
    this.tone(660, 0.05, { type: 'triangle', vol: 0.06 });
  }
}
