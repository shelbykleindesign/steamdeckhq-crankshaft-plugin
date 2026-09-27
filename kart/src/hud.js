// Race HUD: DOM overlay fixed to the screen (it turns with the iPad, like a
// display mounted on the wheel), plus a canvas minimap.

import { formatTime, ordinal } from './race.js';

const $ = (id) => document.getElementById(id);
const SPARK = ['#5ac8ff', '#ff9a1f', '#ff4fd8'];

export class Hud {
  constructor(track) {
    this.track = track;
    this.el = {
      pos: $('hud-pos'),
      posWrap: $('hud-poswrap'),
      lap: $('hud-lap'),
      time: $('hud-time'),
      speed: $('hud-speed'),
      charge: $('hud-charge'),
      banner: $('hud-banner'),
      toast: $('hud-toast'),
      net: $('hud-net'),
      map: $('hud-map'),
      boost: $('hud-boost'),
    };
    this.cache = {};
    this.bannerTimer = 0;
    this.toastTimer = 0;
    this.buildMap();
  }

  set(key, value, apply) {
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    apply(value);
  }

  buildMap() {
    const c = this.el.map;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = 200;
    const H = 140;
    c.width = W * dpr;
    c.height = H * dpr;
    c.style.width = `${W}px`;
    c.style.height = `${H}px`;
    const b = this.track.bounds();
    const pad = 14;
    const scale = Math.min((W - pad * 2) / (b.maxX - b.minX), (H - pad * 2) / (b.maxZ - b.minZ));
    const ox = (W - (b.maxX - b.minX) * scale) / 2;
    const oz = (H - (b.maxZ - b.minZ) * scale) / 2;
    this.map = { W, H, dpr, toX: (x) => ox + (x - b.minX) * scale, toY: (z) => oz + (z - b.minZ) * scale };
    // Pre-render the circuit.
    const base = document.createElement('canvas');
    base.width = c.width;
    base.height = c.height;
    const ctx = base.getContext('2d');
    ctx.scale(dpr, dpr);
    const path = new Path2D();
    const tr = this.track;
    for (let i = 0; i <= tr.count; i += 3) {
      const k = i % tr.count;
      const x = this.map.toX(tr.px[k]);
      const y = this.map.toY(tr.pz[k]);
      if (i === 0) path.moveTo(x, y);
      else path.lineTo(x, y);
    }
    path.closePath();
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 9;
    ctx.stroke(path);
    ctx.strokeStyle = 'rgba(255,255,255,0.92)';
    ctx.lineWidth = 5;
    ctx.stroke(path);
    const s = tr.frameAt(0);
    ctx.strokeStyle = '#ffd400';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(this.map.toX(s.x - s.tz * 9), this.map.toY(s.z + s.tx * 9));
    ctx.lineTo(this.map.toX(s.x + s.tz * 9), this.map.toY(s.z - s.tx * 9));
    ctx.stroke();
    this.mapBase = base;
  }

  drawMap(dots) {
    const c = this.el.map;
    const ctx = c.getContext('2d');
    const { dpr } = this.map;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(this.mapBase, 0, 0);
    ctx.scale(dpr, dpr);
    // Rivals first so the player's dot is always on top.
    for (const d of [...dots].sort((a, b) => a.me - b.me)) {
      const x = this.map.toX(d.x);
      const y = this.map.toY(d.z);
      ctx.beginPath();
      ctx.arc(x, y, d.me ? 6 : 5, 0, Math.PI * 2);
      ctx.fillStyle = d.color;
      ctx.fill();
      ctx.lineWidth = d.me ? 2.5 : 1.5;
      ctx.strokeStyle = d.me ? '#ffffff' : 'rgba(0,0,0,0.6)';
      ctx.stroke();
    }
  }

  /**
   * s: { place, racers, lap, laps, time, speed (m/s), driftLevel, drifting,
   *      boosting, dots: [{x, z, color, me}] }
   */
  update(s, dt) {
    const e = this.el;
    this.set('place', s.racers > 1 ? s.place : 0, (p) => {
      e.posWrap.hidden = !p;
      if (p) {
        e.pos.innerHTML = `${p}<small>${ordinal(p).slice(-2)}</small>`;
        e.posWrap.dataset.place = String(p);
      }
    });
    this.set('lap', `${s.lap}/${s.laps}`, (v) => (e.lap.textContent = v));
    this.set('time', formatTime(Math.max(0, s.time)), (v) => (e.time.textContent = v));
    this.set('speed', Math.round(s.speed * 2.23694), (v) => (e.speed.textContent = String(v)));
    const lvl = s.drifting ? s.driftLevel : 0;
    this.set('charge', `${s.drifting ? 1 : 0}:${lvl}`, () => {
      e.charge.parentElement.dataset.on = s.drifting ? '1' : '0';
      e.charge.style.background = lvl ? SPARK[lvl - 1] : 'rgba(255,255,255,0.5)';
    });
    if (s.drifting) e.charge.style.transform = `scaleX(${Math.min(1, s.driftCharge / 3.2).toFixed(3)})`;
    this.set('boost', s.boosting ? 1 : 0, (v) => (e.boost.dataset.on = String(v)));
    this.drawMap(s.dots);

    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) e.banner.dataset.show = '0';
    }
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) e.toast.dataset.show = '0';
    }
  }

  banner(text, { tone = '', hold = 1.2 } = {}) {
    const b = this.el.banner;
    b.textContent = text;
    b.dataset.tone = tone;
    b.dataset.show = '0';
    // Restart the pop animation.
    void b.offsetWidth;
    b.dataset.show = '1';
    this.bannerTimer = hold;
  }

  clearBanner() {
    this.el.banner.dataset.show = '0';
    this.bannerTimer = 0;
  }

  toast(text, hold = 2.2) {
    const t = this.el.toast;
    t.textContent = text;
    t.dataset.show = '1';
    this.toastTimer = hold;
  }

  netStatus(text, tone = '') {
    const n = this.el.net;
    n.textContent = text;
    n.dataset.tone = tone;
    n.hidden = !text;
  }

  reset() {
    this.cache = {};
    this.clearBanner();
    this.el.toast.dataset.show = '0';
    this.toastTimer = 0;
    this.netStatus('');
  }
}
