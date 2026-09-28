import { AIDriver } from './ai.js';
import { KART_COLORS, NET, PHYS, RACE, STEER } from './config.js';
import { Hud } from './hud.js';
import { ScreenHold } from './hold.js';
import { Controls } from './input.js';
import { Kart, collideKarts } from './kart.js';
import { Link, cleanCode } from './net.js';
import { LapTracker, formatTime, ordinal, standings } from './race.js';
import { cleanName, colorHex, loadSettings, saveSettings } from './settings.js';
import { Sound } from './sound.js';
import { TiltInput, currentScreenDeg, steerInput } from './tilt.js';
import { Track } from './track.js';
import { View } from './view.js';

const $ = (id) => document.getElementById(id);
const DEG = Math.PI / 180;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;
const lerpAngle = (a, b, t) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;
const params = new URLSearchParams(location.search);

const settings = loadSettings();
const track = new Track();
const tilt = new TiltInput();
const controls = new Controls(tilt, settings);
const sound = new Sound(settings.sound);
const view = new View($('scene'), track);
const hud = new Hud(track);

let link = null;
let race = null;
let screen = 'title';
let rotationTipShown = false;

const hold = new ScreenHold({
  turnSign: () => {
    const r = tilt.read();
    return r && Math.abs(r.steer) > 5 * DEG ? Math.sign(r.steer) : 0;
  },
  onChange: (turn, changed) => {
    tilt.held = turn !== 0;
    orientationHint();
    view.resize();
    if (turn && changed && !rotationTipShown) {
      rotationTipShown = true;
      hud.toast('Tip: Rotation Lock in Control Center stops the screen turning', 5);
    }
  },
});

// ---------------------------------------------------------------------------
// Screens & modals

function show(name) {
  screen = name;
  document.body.dataset.screen = name;
  closeModals();
  hold.set(name === 'race');
}

function openModal(id) {
  $(id).dataset.open = '1';
}

function closeModals() {
  document.querySelectorAll('.modal').forEach((m) => (m.dataset.open = '0'));
}

function status(id, text, tone = '') {
  const el = $(id);
  el.dataset.tone = tone;
  el.querySelector('span').textContent = text;
}

// ---------------------------------------------------------------------------
// Device setup that must happen inside a user gesture (iOS)

let wakeLock = null;
async function keepAwake() {
  try {
    if ('wakeLock' in navigator && !wakeLock && document.visibilityState === 'visible') {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => (wakeLock = null));
    }
  } catch {
    // Not supported or refused: the race still works.
  }
}

let sensorChecked = false;
function prepareDevice() {
  // requestPermission must run first, synchronously inside the tap handler.
  const p = tilt.request();
  sound.unlock();
  keepAwake();
  p.then((state) => {
    if (state === 'denied') openModal('modal-motion');
    else if (state === 'granted' && isTouch() && !sensorChecked) {
      sensorChecked = true;
      setTimeout(() => {
        if (!tilt.active) hud.toast('No motion data: this device may not have an accelerometer.', 4);
      }, 2500);
    }
  });
  return p;
}

const isTouch = () => navigator.maxTouchPoints > 0 || 'ontouchstart' in window;

// ---------------------------------------------------------------------------
// Race session

class RaceSession {
  /**
   * @param {object} o
   * @param {'solo'|'online'} o.mode
   * @param {number} o.laps
   * @param {number} o.goAt   performance.now() of the green light
   * @param {number} o.slot   -1 left grid slot, 1 right
   * @param {{name: string, color: string}} o.rival
   * @param {number} [o.id]  online race id; messages from other races are ignored
   */
  constructor(o) {
    this.mode = o.mode;
    this.id = o.id ?? 0;
    this.laps = o.laps;
    this.goAt = o.goAt;
    this.phase = 'countdown';
    this.simTime = 0;
    this.lastCount = null;
    this.sendTimer = 0;
    this.wrongWay = 0;
    this.finishedAt = null;
    this.paused = false;
    this.resultsShown = false;
    this.pausedAt = 0;

    this.me = {
      id: 'me',
      name: settings.name,
      color: colorHex(settings.color),
      kart: new Kart(track),
      laps: new LapTracker(track.length, o.laps),
    };
    this.me.kart.place(-RACE.gridBack, o.slot * RACE.gridLateral);
    this.autopilot = null;

    const rival = { id: 'rival', name: o.rival.name, color: o.rival.color, left: false };
    if (this.mode === 'solo') {
      rival.kart = new Kart(track);
      rival.kart.place(-RACE.gridBack, -o.slot * RACE.gridLateral);
      rival.ai = new AIDriver(rival.kart, { pace: 0.95 });
      rival.laps = new LapTracker(track.length, o.laps);
    } else {
      rival.snaps = [];
      const g = track.frameAt(-RACE.gridBack, -o.slot * RACE.gridLateral);
      rival.grid = {
        x: g.x,
        z: g.z,
        h: g.heading,
        vx: 0,
        vz: 0,
        speed: 0,
        steer: 0,
        drift: 0,
        driftLevel: 0,
        boost: 0,
        hop: 0,
      };
      rival.dist = -RACE.gridBack;
      rival.finishTime = null;
      rival.best = null;
      rival.pose = rival.grid;
    }
    this.rival = rival;

    view.setPlayer(this.me.color);
    view.clearRivals();
    view.setRival('rival', rival.name, rival.color);
    tilt.lock();
    controls.release();
    hud.reset();
    document.body.dataset.fresh = '1';
  }

  get raceTime() {
    return ((this.paused ? this.pausedAt : performance.now()) - this.goAt) / 1000;
  }

  pause() {
    if (this.mode !== 'solo' || this.paused || this.resultsShown) return;
    this.paused = true;
    this.pausedAt = performance.now();
  }

  resume() {
    if (!this.paused) return;
    this.goAt += performance.now() - this.pausedAt;
    this.paused = false;
  }

  frame(now, dt) {
    const input = controls.read(dt);
    const t = this.raceTime;

    if (t < 0) {
      const n = Math.ceil(-t);
      if (n <= RACE.countdown && n !== this.lastCount) {
        this.lastCount = n;
        hud.banner(String(n), { tone: 'count', hold: 0.9 });
        sound.countdown(n);
      } else if (this.lastCount === null && n > RACE.countdown) {
        this.lastCount = n;
        hud.banner(this.mode === 'online' ? `vs ${this.rival.name}` : 'Get ready', { tone: 'info', hold: 1 });
      }
    } else if (this.phase === 'countdown') {
      this.phase = 'racing';
      hud.banner('GO!', { tone: 'go', hold: 0.8 });
      sound.countdown(0);
      setTimeout(() => (document.body.dataset.fresh = '0'), 4000);
    }

    if (this.phase === 'racing' && !this.paused) {
      let steps = 0;
      while (this.simTime + PHYS.dt <= t && steps < 12) {
        this.step(PHYS.dt, input);
        this.simTime += PHYS.dt;
        steps++;
      }
      // After a stall (backgrounded tab) don't fast-forward: drop the lost time.
      if (t - this.simTime > PHYS.dt) this.simTime = t;
    }
    const alpha = this.phase === 'racing' ? clamp((t - this.simTime) / PHYS.dt, 0, 1) : 1;

    if (this.phase === 'racing') this.bookkeeping(t, dt);
    this.present(now, t, dt, input, alpha);
  }

  step(dt, input) {
    const me = this.me;
    const inp = this.autopilot
      ? this.autopilot.think(dt)
      : { steer: input.steer, throttle: input.throttle, brake: input.brake, drift: input.drift };
    me.kart.step(dt, inp);
    if (this.mode === 'solo') {
      const r = this.rival;
      r.kart.step(dt, r.ai.think(dt, { rivalDist: me.kart.dist }));
      if (collideKarts(me.kart, r.kart, true) > 3) me.kart.events.push('bump');
    } else if (!this.rival.left && this.rival.snaps.length) {
      const p = this.rival.pose;
      const proxy = { x: p.x, z: p.z, vx: p.vx, vz: p.vz };
      if (collideKarts(me.kart, proxy, false) > 3) me.kart.events.push('bump');
    }
  }

  bookkeeping(t, dt) {
    const me = this.me;
    const ev = me.laps.update(me.kart.dist, t);
    if (ev === 'lap') {
      const lt = me.laps.lapTimes[me.laps.lapTimes.length - 1];
      const best = me.laps.best === lt && me.laps.lapTimes.length > 1;
      hud.toast(`Lap ${me.laps.completed} · ${formatTime(lt)}${best ? ' · best' : ''}`);
      sound.lap();
      if (me.laps.completed === this.laps - 1) hud.banner('FINAL LAP', { tone: 'info', hold: 1.6 });
    } else if (ev === 'finish') {
      this.onFinish(t);
    }
    if (this.mode === 'solo') {
      this.rival.laps.update(this.rival.kart.dist, t);
      this.rival.kart.drainEvents();
    }

    for (const e of me.kart.drainEvents()) {
      if (this.autopilot) continue;
      if (e === 'hop') sound.hop();
      else if (e === 'turbo' || e === 'pad') sound.boost();
      else if (e === 'spark') sound.spark(me.kart.driftLevel);
      else if (e === 'wall') {
        sound.wall(me.kart.wallHit);
        view.bump(0.6);
      } else if (e === 'bump') {
        sound.wall(6);
        view.bump(0.5);
      }
    }

    // Wrong-way warning.
    if (!this.autopilot) {
      const f = track.frameAt(me.kart.s);
      const along = me.kart.vx * f.tx + me.kart.vz * f.tz;
      this.wrongWay = along < -2 ? this.wrongWay + dt : Math.max(0, this.wrongWay - dt * 2);
      if (this.wrongWay > 1.2 && hud.bannerTimer <= 0) hud.banner('WRONG WAY', { tone: 'warn', hold: 0.6 });
    }

    if (this.mode === 'online') {
      this.sendTimer -= dt;
      if (this.sendTimer <= 0) {
        this.sendTimer = 1 / NET.sendHz;
        this.sendState(t);
      }
    }
  }

  sendState(t) {
    if (!link) return;
    const k = this.me.kart;
    const r2 = (v) => Math.round(v * 100) / 100;
    link.send({
      t: 's',
      id: this.id,
      rt: Math.round(t * 1000) / 1000,
      x: r2(k.x),
      z: r2(k.z),
      h: Math.round(k.h * 1000) / 1000,
      vx: r2(k.vx),
      vz: r2(k.vz),
      st: r2(k.steer),
      dr: k.drift,
      dl: k.driftLevel,
      bo: k.boost > 0 ? 1 : 0,
      hp: r2(k.hopAnim),
      d: Math.round(k.dist * 10) / 10,
      ft: this.me.laps.finishTime,
      bl: this.me.laps.best,
    });
  }

  onRemoteState(m) {
    const r = this.rival;
    // Late packets from the previous race would otherwise poison the buffer.
    if (r.left || m.id !== this.id || typeof m.rt !== 'number') return;
    const snaps = r.snaps;
    if (snaps.length && m.rt <= snaps[snaps.length - 1].rt) return; // stale / duplicate
    snaps.push(m);
    if (snaps.length > 40) snaps.shift();
    r.dist = m.d;
    if (m.ft !== null && m.ft !== undefined && r.finishTime === null) this.onRemoteFinish({ time: m.ft, best: m.bl });
  }

  onRemoteFinish(m) {
    const r = this.rival;
    if (r.finishTime !== null || (m.id !== undefined && m.id !== this.id)) return;
    r.finishTime = m.time;
    r.best = m.best ?? null;
    if (!this.me.laps.finished) hud.toast(`${r.name} finished · ${formatTime(m.time)}`, 2.5);
    if (this.resultsShown) renderResults();
  }

  opponentLeft(reason) {
    const r = this.rival;
    if (r.left) return;
    r.left = true;
    view.poseRival('rival', null);
    hud.toast(reason, 3);
    hud.netStatus('');
    if (this.resultsShown) renderResults();
  }

  onFinish(t) {
    this.finishedAt = performance.now();
    const place = this.placeOf(this.me);
    hud.banner(place === 1 ? 'YOU WIN!' : 'FINISH!', { tone: 'go', hold: 2.4 });
    sound.finish();
    if (this.mode === 'online' && link) link.send({ t: 'fin', id: this.id, time: t, best: this.me.laps.best });
    this.autopilot = new AIDriver(this.me.kart, { pace: 0.8 });
    setTimeout(() => {
      if (race === this) showResults();
    }, 2600);
  }

  /** Remote pose at race time rt from the snapshot buffer. */
  sampleRemote(rt) {
    const r = this.rival;
    const s = r.snaps;
    if (!s.length) return r.grid;
    const toPose = (a) => ({
      x: a.x,
      z: a.z,
      h: a.h,
      vx: a.vx,
      vz: a.vz,
      speed: Math.hypot(a.vx, a.vz),
      steer: a.st,
      drift: a.dr,
      driftLevel: a.dl,
      boost: a.bo,
      hop: a.hp,
    });
    if (rt <= s[0].rt) return toPose(s[0]);
    for (let i = s.length - 1; i >= 0; i--) {
      const a = s[i];
      if (a.rt > rt) continue;
      const b = s[i + 1];
      if (b) {
        const k = (rt - a.rt) / (b.rt - a.rt || 1);
        const p = toPose(a);
        p.x = lerp(a.x, b.x, k);
        p.z = lerp(a.z, b.z, k);
        p.h = lerpAngle(a.h, b.h, k);
        p.vx = lerp(a.vx, b.vx, k);
        p.vz = lerp(a.vz, b.vz, k);
        p.speed = Math.hypot(p.vx, p.vz);
        p.steer = lerp(a.st, b.st, k);
        return p;
      }
      // Past the newest snapshot: extrapolate briefly, then hold.
      const ahead = Math.min(rt - a.rt, NET.extrapolateMax);
      const p = toPose(a);
      p.x += a.vx * ahead;
      p.z += a.vz * ahead;
      return p;
    }
    return toPose(s[0]);
  }

  placeOf(racer) {
    const list = this.racers();
    return list.findIndex((r) => r.id === racer.id) + 1;
  }

  racers() {
    const me = { id: 'me', finishTime: this.me.laps.finishTime, dist: this.me.kart.dist };
    const list = [me];
    const r = this.rival;
    if (this.mode === 'solo') list.push({ id: 'rival', finishTime: r.laps.finishTime, dist: r.kart.dist });
    else if (!r.left) list.push({ id: 'rival', finishTime: r.finishTime, dist: r.dist });
    return standings(list);
  }

  present(now, t, dt, input, alpha) {
    const time = now / 1000;
    const k = this.me.kart;
    const st = {
      x: lerp(k.px, k.x, alpha),
      z: lerp(k.pz, k.z, alpha),
      h: lerpAngle(k.ph, k.h, alpha),
      speed: k.speed,
      steer: k.steer,
      drift: k.drift,
      driftLevel: k.driftLevel,
      boost: k.boost,
      hop: k.hopAnim,
      onRoad: k.onRoad,
    };
    if (this.finishedAt && now - this.finishedAt > 1200) view.chaseView(st, dt, time);
    else view.firstPerson(st, -input.viewRoll, input.wheelAngle, dt, time);

    // Rival.
    let rp = null;
    const r = this.rival;
    if (this.mode === 'solo') {
      const rk = r.kart;
      rp = {
        x: lerp(rk.px, rk.x, alpha),
        z: lerp(rk.pz, rk.z, alpha),
        h: lerpAngle(rk.ph, rk.h, alpha),
        vx: rk.vx,
        vz: rk.vz,
        speed: rk.speed,
        steer: rk.steer,
        drift: rk.drift,
        driftLevel: rk.driftLevel,
        boost: rk.boost,
        hop: rk.hopAnim,
      };
    } else if (!r.left) {
      rp = this.phase === 'racing' ? this.sampleRemote(t - NET.interpDelay) : r.grid;
      r.pose = rp;
    }
    view.poseRival('rival', rp, dt, time);

    // HUD.
    const dots = [{ x: st.x, z: st.z, color: this.me.color, me: true }];
    if (rp) dots.push({ x: rp.x, z: rp.z, color: r.color, me: false });
    hud.update(
      {
        place: this.placeOf(this.me),
        racers: this.mode === 'solo' || !r.left ? 2 : 1,
        lap: this.me.laps.lap,
        laps: this.laps,
        time: this.me.laps.finished ? this.me.laps.finishTime : t,
        speed: k.speed,
        drifting: k.drift !== 0,
        driftLevel: k.driftLevel,
        driftCharge: k.driftTime,
        boosting: k.boost > 0,
        dots,
      },
      dt,
    );
    if (this.mode === 'online' && !r.left && link && link.connected && !link.stale && link.rtt) {
      hud.netStatus(`${Math.round(link.rtt)} ms`, '');
    }

    // Audio.
    let rivalAudio = null;
    if (rp) {
      const dx = rp.x - st.x;
      const dz = rp.z - st.z;
      const right = dx * Math.cos(st.h) - dz * Math.sin(st.h);
      const dist = Math.hypot(dx, dz);
      rivalAudio = { dist, speed: rp.speed, pan: dist > 0.1 ? right / dist : 0 };
    }
    const slip = Math.abs(k.vx * Math.cos(k.h) - k.vz * Math.sin(k.h));
    sound.update({
      active: !this.paused,
      speed: k.speed,
      maxSpeed: PHYS.maxSpeed,
      throttle: this.phase === 'racing' ? input.throttle * (input.brake ? 0 : 1) : 0.2,
      skid: k.drift ? 0.9 : k.onRoad ? clamp((slip - 3) / 6, 0, 1) : clamp(k.speed / 12, 0, 0.5),
      rival: rivalAudio,
    });
  }
}

// ---------------------------------------------------------------------------
// Starting races

function rivalColorFor(mine) {
  const pool = KART_COLORS.filter((c) => c.id !== mine && c.id !== 'yellow');
  return pool[Math.floor(Math.random() * pool.length)].hex;
}

function startSolo() {
  race = new RaceSession({
    mode: 'solo',
    laps: settings.laps,
    goAt: performance.now() + (RACE.startLead + RACE.countdown) * 1000,
    slot: -1,
    rival: { name: 'CPU', color: rivalColorFor(settings.color) },
  });
  show('race');
}

function startOnline(goAtLocal, laps, id) {
  if (!link || !link.remote) return;
  race = new RaceSession({
    mode: 'online',
    id,
    laps,
    goAt: goAtLocal,
    slot: link.role === 'host' ? -1 : 1,
    rival: { name: link.remote.name, color: colorHex(link.remote.color) },
  });
  show('race');
}

function hostStartRace() {
  if (!link || !link.connected) return;
  const at = performance.now() + (RACE.startLead + RACE.countdown) * 1000;
  const id = Math.floor(Math.random() * 1e9);
  link.send({ t: 'start', id, at, laps: settings.laps });
  startOnline(at, settings.laps, id);
}

// ---------------------------------------------------------------------------
// Online lobby

function newLink() {
  if (link) link.close();
  link = new Link({ name: settings.name, color: settings.color });
  link.on('peer', (remote) => {
    sound.click();
    renderVersus();
    if (link.role === 'host') {
      status('host-status', `${remote.name} joined. Ready when you are.`, 'ok');
      $('btn-host-start').disabled = false;
      if (screen === 'results') renderResults();
    }
  });
  link.on('lost', (reason) => {
    if (race && race.mode === 'online') race.opponentLeft(reason);
    if (link && link.role === 'host') {
      $('btn-host-start').disabled = true;
      status('host-status', 'Waiting for an opponent…', 'wait');
      renderVersus();
      if (screen === 'results') renderResults();
    } else {
      link = null;
      if (screen === 'lobby' || screen === 'results') {
        show('join');
        status('join-status', reason, 'bad');
      }
    }
  });
  link.on('stale', (stale) => {
    if (race) hud.netStatus(stale ? 'Connection lost… waiting' : '', stale ? 'bad' : '');
  });
  link.on('down', (reason) => {
    // The host lost the race server, and its code with it.
    link = null;
    if (screen === 'host') {
      status('host-status', reason, 'bad');
      $('btn-host-start').hidden = true;
      $('btn-host-retry').hidden = false;
    } else if (screen === 'results') {
      renderResults();
    }
  });
  link.on('message', (msg) => {
    if (msg.t === 'start' && link.role === 'guest') startOnline(link.toLocal(msg.at), msg.laps, msg.id);
    else if (msg.t === 's') race?.onRemoteState(msg);
    else if (msg.t === 'fin') race?.onRemoteFinish(msg);
  });
  return link;
}

async function hostGame() {
  show('host');
  $('btn-host-start').disabled = true;
  $('btn-host-start').hidden = false;
  $('btn-host-retry').hidden = true;
  setCode('····');
  status('host-status', 'Creating a race code…', 'wait');
  renderLaps();
  const l = newLink();
  try {
    const code = await l.host();
    if (link !== l) return;
    setCode(code);
    status('host-status', 'Waiting for an opponent…', 'wait');
  } catch (e) {
    if (link !== l) return;
    status('host-status', e.message, 'bad');
    $('btn-host-start').hidden = true;
    $('btn-host-retry').hidden = false;
    link = null;
  }
}

function setCode(code) {
  $('host-code').innerHTML = code
    .split('')
    .map((c) => `<span>${c}</span>`)
    .join('');
}

async function joinGame() {
  const code = cleanCode($('join-code').value);
  if (code.length < 4) {
    status('join-status', 'Enter the 4-letter code shown on the host’s screen.', 'bad');
    return;
  }
  $('join-code').blur();
  status('join-status', `Connecting to ${code}…`, 'wait');
  $('btn-join-go').disabled = true;
  const l = newLink();
  try {
    await l.join(code);
    if (link !== l) return;
    show('lobby');
    renderVersus();
    status('lobby-status', `Waiting for ${l.remote.name} to start the race…`, 'wait');
  } catch (e) {
    if (link === l) link = null;
    status('join-status', e.message, 'bad');
  } finally {
    $('btn-join-go').disabled = false;
  }
}

function renderVersus() {
  const me = { name: settings.name, color: colorHex(settings.color) };
  const them = link && link.remote ? { name: link.remote.name, color: colorHex(link.remote.color) } : null;
  const chip = (p) =>
    p
      ? `<span class="chip"><i style="background:${p.color}"></i>${escapeHtml(p.name)}</span>`
      : `<span class="chip empty"><i></i>Waiting…</span>`;
  for (const id of ['host-versus', 'lobby-versus']) {
    $(id).innerHTML = `${chip(me)}<b>vs</b>${chip(them)}`;
  }
}

function renderLaps() {
  document.querySelectorAll('[data-laps]').forEach((b) => {
    b.setAttribute('aria-pressed', String(Number(b.dataset.laps) === settings.laps));
  });
}

function leaveToTitle() {
  if (link) link.close();
  link = null;
  race = null;
  tilt.unlock();
  show('title');
}

// ---------------------------------------------------------------------------
// Results

function showResults() {
  if (!race) return;
  race.resultsShown = true;
  show('results');
  renderResults();
}

function renderResults() {
  if (!race) return;
  const r = race;
  const rows = [
    {
      id: 'me',
      name: r.me.name,
      color: r.me.color,
      finishTime: r.me.laps.finishTime,
      best: r.me.laps.best,
      dist: r.me.kart.dist,
    },
  ];
  const rv = r.rival;
  if (r.mode === 'solo') {
    rows.push({
      id: 'rival',
      name: rv.name,
      color: rv.color,
      finishTime: rv.laps.finishTime,
      best: rv.laps.best,
      dist: rv.kart.dist,
    });
  } else {
    rows.push({
      id: 'rival',
      name: rv.name,
      color: rv.color,
      finishTime: rv.finishTime,
      best: rv.best,
      dist: rv.dist,
      left: rv.left,
    });
  }
  const order = standings(rows.filter((x) => !x.left)).concat(rows.filter((x) => x.left));
  const myPlace = order.findIndex((x) => x.id === 'me') + 1;
  const waiting = r.mode === 'online' && !rv.left && rv.finishTime === null;

  $('res-place').textContent = ordinal(myPlace);
  $('res-place').dataset.place = String(myPlace);
  let line;
  if (rv.left) line = `${rv.name} left the race.`;
  else if (waiting) line = `${rv.name} is still racing…`;
  else if (myPlace === 1) {
    const other = order[1];
    const gap = other.finishTime !== null ? other.finishTime - r.me.laps.finishTime : null;
    line = gap !== null ? `You beat ${other.name} by ${gap.toFixed(2)} s.` : `You beat ${other.name}.`;
  } else {
    const gap = order[0].finishTime !== null ? r.me.laps.finishTime - order[0].finishTime : null;
    line = gap !== null ? `${order[0].name} won by ${gap.toFixed(2)} s.` : `${order[0].name} won.`;
  }
  $('res-line').textContent = line;
  $('res-table').innerHTML = order
    .map((x, i) => {
      const time = x.left ? 'Left' : x.finishTime !== null ? formatTime(x.finishTime) : 'Racing…';
      return `<tr class="${x.id === 'me' ? 'me' : ''}"><td>${x.left ? '–' : i + 1}</td><td><i style="background:${x.color}"></i>${escapeHtml(x.name)}</td><td>${time}</td><td>${x.best ? formatTime(x.best) : '—'}</td></tr>`;
    })
    .join('');

  const again = $('btn-rematch');
  const note = $('res-status');
  if (r.mode === 'solo') {
    again.hidden = false;
    again.disabled = false;
    note.hidden = true;
  } else if (link && link.role === 'host') {
    const ready = link.connected && !waiting;
    again.hidden = false;
    again.disabled = !ready;
    note.hidden = ready;
    status(
      'res-status',
      link.connected ? `Waiting for ${rv.name} to finish…` : 'Waiting for an opponent to join…',
      'wait',
    );
  } else {
    again.hidden = true;
    note.hidden = false;
    status(
      'res-status',
      link && link.connected ? `Waiting for ${rv.name} to start the next race…` : 'Disconnected.',
      'wait',
    );
  }
}

function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}

// ---------------------------------------------------------------------------
// Settings

function renderSettings() {
  renderLaps();
  $('set-name').value = settings.name;
  $('set-colors').innerHTML = KART_COLORS.map(
    (c) =>
      `<button type="button" class="swatch" data-color="${c.id}" aria-label="${c.name}" aria-pressed="${c.id === settings.color}" style="--c:${c.hex}"></button>`,
  ).join('');
  $('set-angle').min = STEER.minMaxAngle;
  $('set-angle').max = STEER.maxMaxAngle;
  $('set-angle').value = settings.maxAngle;
  $('set-angle-val').textContent = `${settings.maxAngle}°`;
  $('set-lock').checked = settings.horizonLock;
  $('set-sound').checked = settings.sound;
}

function commitSettings() {
  settings.name = cleanName($('set-name').value) || settings.name;
  saveSettings(settings);
}

function tiltProbe() {
  // Live steering meter in the settings sheet.
  const box = $('modal-settings');
  if (box.dataset.open !== '1') return;
  const bar = $('probe-bar');
  const label = $('probe-label');
  const r = tilt.active ? tilt.read() : null;
  if (!r) {
    bar.style.transform = 'translateX(-50%) scaleX(0)';
    label.textContent = tilt.permission === 'denied' ? 'Motion access denied' : 'Turn the device to test';
    return;
  }
  const v = steerInput(r.steer, settings.maxAngle);
  bar.style.transform = `translateX(${v >= 0 ? 0 : -100}%) scaleX(${Math.abs(v).toFixed(3)})`;
  label.textContent = `${(r.steer / DEG).toFixed(0)}° → ${Math.round(v * 100)}% ${v > 0 ? 'right' : v < 0 ? 'left' : ''}`;
}

// ---------------------------------------------------------------------------
// Events

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action], [data-laps], [data-color]');
  if (!el) return;
  if (el.dataset.laps) {
    settings.laps = Number(el.dataset.laps);
    saveSettings(settings);
    renderLaps();
    return;
  }
  if (el.dataset.color) {
    settings.color = el.dataset.color;
    saveSettings(settings);
    renderSettings();
    return;
  }
  const action = el.dataset.action;
  switch (action) {
    case 'solo':
      prepareDevice();
      startSolo();
      break;
    case 'host':
      prepareDevice();
      hostGame();
      break;
    case 'join':
      prepareDevice();
      show('join');
      status('join-status', '', '');
      setTimeout(() => $('join-code').focus(), 50);
      break;
    case 'join-go':
      prepareDevice();
      joinGame();
      break;
    case 'host-start':
      prepareDevice();
      hostStartRace();
      break;
    case 'rematch':
      prepareDevice();
      if (race && race.mode === 'solo') startSolo();
      else hostStartRace();
      break;
    case 'leave':
      if (link && link.role === 'host' && screen === 'results') {
        // Host backs out to the lobby, keeping the same code and opponent.
        race = null;
        show('host');
        renderVersus();
        renderLaps();
        $('btn-host-start').disabled = !link.connected;
        if (link.connected) status('host-status', `${link.remote.name} is here. Ready when you are.`, 'ok');
        else status('host-status', 'Waiting for an opponent…', 'wait');
        break;
      }
      leaveToTitle();
      break;
    case 'settings':
      prepareDevice();
      renderSettings();
      openModal('modal-settings');
      break;
    case 'settings-done':
      commitSettings();
      closeModals();
      break;
    case 'howto':
      openModal('modal-howto');
      break;
    case 'close':
      closeModals();
      if (race) race.resume();
      break;
    case 'pause':
      if (!race) break;
      race.pause();
      $('pause-note').hidden = race.mode === 'solo';
      openModal('modal-pause');
      break;
    case 'recenter':
      tilt.recenter();
      hud.toast('Steering centred on how you’re holding it', 2);
      closeModals();
      if (race) race.resume();
      break;
    case 'recenter-settings':
      tilt.recenter();
      break;
    case 'reset-center':
      tilt.resetCenter();
      break;
    case 'quit':
      if (race && race.mode === 'online') {
        leaveToTitle();
      } else {
        race = null;
        tilt.unlock();
        show('title');
      }
      break;
    default:
      break;
  }
});

$('set-angle').addEventListener('input', (e) => {
  settings.maxAngle = Number(e.target.value);
  $('set-angle-val').textContent = `${settings.maxAngle}°`;
  saveSettings(settings);
});
$('set-lock').addEventListener('change', (e) => {
  settings.horizonLock = e.target.checked;
  saveSettings(settings);
});
$('set-sound').addEventListener('change', (e) => {
  settings.sound = e.target.checked;
  sound.setEnabled(settings.sound);
  saveSettings(settings);
});
$('set-name').addEventListener('change', commitSettings);

$('join-code').addEventListener('input', (e) => {
  const v = cleanCode(e.target.value);
  if (e.target.value !== v) e.target.value = v;
});
$('join-code').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    prepareDevice();
    joinGame();
  }
});

controls.bindZone($('zone-brake'), 'brake', (on) => ($('zone-brake').dataset.on = on ? '1' : '0'));
controls.bindZone($('zone-drift'), 'drift', (on) => ($('zone-drift').dataset.on = on ? '1' : '0'));

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    controls.release();
    if (race && race.mode === 'solo' && screen === 'race') {
      race.pause();
      $('pause-note').hidden = true;
      openModal('modal-pause');
    }
  } else {
    if (sound.ctx) sound.unlock();
    if (race) keepAwake();
  }
});

// Stop iOS pinch/double-tap zoom from hijacking the game.
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());

function orientationHint() {
  // The body's box, which is the race's shape while the screen is held.
  const portrait = document.body.clientHeight > document.body.clientWidth;
  document.body.dataset.portrait = portrait ? '1' : '0';
}
window.addEventListener('resize', orientationHint);
orientationHint();

// Keyboard hint for desktops without motion sensors.
if (!isTouch()) document.body.dataset.desktop = '1';
if (controls.sim) document.body.dataset.sim = '1';

// ---------------------------------------------------------------------------
// Main loop

const debugEl = params.has('debug') ? $('debug') : null;
if (debugEl) debugEl.hidden = false;

let last = performance.now();
function loop(now) {
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
  last = now;
  if (race && (screen === 'race' || screen === 'results')) {
    race.frame(now, dt);
  } else {
    view.attract(now / 1000);
    sound.update({ active: false });
  }
  view.render(now / 1000, dt);
  tiltProbe();
  if (debugEl) {
    const r = tilt.read();
    debugEl.textContent = [
      `fps ${view.fps ? view.fps.toFixed(0) : '–'}  px ${view.pixelRatio}`,
      `screen ${currentScreenDeg()}°  ref ${tilt.refDeg}°  sign ${tilt.sign}`,
      r
        ? `steer ${(r.steer / DEG).toFixed(1)}°  roll ${(r.viewRoll / DEG).toFixed(1)}°  planar ${r.planar.toFixed(2)}`
        : 'no tilt data',
      link ? `net ${link.role} rtt ${link.rtt.toFixed(0)} off ${link.offset.toFixed(0)}` : '',
    ].join('\n');
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// Hooks for automated tests and debugging.
window.__kart = {
  tilt,
  controls,
  settings,
  view,
  track,
  get race() {
    return race;
  },
  get link() {
    return link;
  },
  /** Let the CPU drive the player's kart (used by the end-to-end tests). */
  autopilot(pace = 1) {
    if (race) race.autopilot = new AIDriver(race.me.kart, { pace });
  },
};
