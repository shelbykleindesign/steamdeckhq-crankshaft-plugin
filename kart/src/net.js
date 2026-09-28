// Two-player link through the relay on our own server (serve/relay.mjs, at /net
// on the same origin as the page). The host opens a room under a fresh code,
// the guest joins it with that code, and the relay passes messages between
// them. It all rides the HTTPS connection that served the page, so it works on
// any network that can load the game.

import { CODE_ALPHABET, CODE_LENGTH, NET, PROTOCOL_VERSION } from './config.js';

const UNREACHABLE = "Can't reach the race server. Check your internet connection and try again.";

export function makeCode() {
  let s = '';
  const buf = new Uint32Array(CODE_LENGTH);
  crypto.getRandomValues(buf);
  for (let i = 0; i < CODE_LENGTH; i++) s += CODE_ALPHABET[buf[i] % CODE_ALPHABET.length];
  return s;
}

/** Uppercase, drop anything that can't appear in a code. */
export function cleanCode(input) {
  return String(input || '')
    .toUpperCase()
    .split('')
    .filter((ch) => CODE_ALPHABET.includes(ch))
    .join('')
    .slice(0, CODE_LENGTH);
}

export class Link {
  constructor(profile) {
    this.profile = profile; // { name, color }
    this.ws = null;
    this.role = null;
    this.code = null;
    this.remote = null; // { name, color }
    this.offset = 0; // remote clock minus local clock (ms)
    this.rtt = 0;
    this.samples = [];
    this.lastHeard = 0; // last message from the other player
    this.lastRelay = 0; // last message of any kind, relay keepalives included
    this.stale = false;
    this.timer = null;
    this.watchdog = null;
    this.pending = null; // the host() or join() promise, until it settles
    this.tries = 0;
    this.closed = false;
    this.handlers = {};
  }

  on(event, fn) {
    this.handlers[event] = fn;
    return this;
  }

  emit(event, data) {
    const fn = this.handlers[event];
    if (fn) fn(data);
  }

  get connected() {
    return !!(this.ws && this.ws.readyState === WebSocket.OPEN && this.remote && !this.closed);
  }

  /** Open a room under a fresh code. Resolves with the code. */
  host() {
    this.role = 'host';
    const done = this.wait(UNREACHABLE);
    this.openRoom();
    return done;
  }

  openRoom() {
    this.code = makeCode();
    this.open(`host=${this.code}`);
  }

  /** Join the room with this code. Resolves with the host's profile. */
  join(code) {
    this.role = 'guest';
    this.code = code;
    const done = this.wait("Couldn't connect. Check the code, and that both devices are online.");
    this.open(`join=${code}`);
    return done;
  }

  wait(timeoutMessage) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.settle(timeoutMessage), NET.connectTimeoutMs);
      this.pending = { resolve, reject, timer };
    });
  }

  /** Settle the pending host() or join(): with an error message, or a value. */
  settle(error, value) {
    const p = this.pending;
    if (!p) return;
    this.pending = null;
    clearTimeout(p.timer);
    if (error) {
      this.close(false);
      p.reject(new Error(error));
    } else {
      p.resolve(value);
    }
  }

  open(query) {
    let ws;
    try {
      ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/net?${query}`);
    } catch {
      this.settle(UNREACHABLE);
      return;
    }
    this.ws = ws;
    this.lastRelay = performance.now();
    const current = () => this.ws === ws && !this.closed;
    ws.onmessage = (e) => {
      if (!current()) return;
      this.lastRelay = performance.now();
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      if (!msg || typeof msg !== 'object') return;
      if (typeof msg.relay === 'string') this.control(msg.relay);
      else this.receive(msg);
    };
    // An error always means the socket is finished; don't count on a 'close' after it.
    ws.onerror = ws.onclose = () => current() && this.dropped();
    if (!this.watchdog) {
      // The relay sends a keepalive every 20 s; silence means the socket is dead
      // even if the browser hasn't noticed yet.
      this.watchdog = setInterval(() => {
        if (this.ws && performance.now() - this.lastRelay > NET.relayTimeoutMs) this.dropped();
      }, 5000);
    }
  }

  /** Messages from the relay itself (see serve/relay.mjs). */
  control(what) {
    switch (what) {
      case 'room':
        this.settle(null, this.code);
        return;
      case 'taken':
        // Someone else is using this code: pick another.
        this.detach();
        if (this.tries++ < 5) this.openRoom();
        else this.settle('Could not create a race code. Try again.');
        return;
      case 'busy':
        this.settle('The race server is busy. Try again in a minute.');
        return;
      case 'paired':
        this.send({ t: 'hello', v: PROTOCOL_VERSION, name: this.profile.name, color: this.profile.color });
        return;
      case 'nohost':
        this.settle(
          `No race found with code ${this.code}. Check the letters, and make sure the host's screen still shows the code.`,
        );
        return;
      case 'full':
        this.settle('That race already has two players.');
        return;
      case 'left':
        this.lost('The other player left.');
        return;
      case 'bad':
        this.settle('Connection problem. Try again.');
        return;
      // 'ka' (keepalive) needs nothing beyond the lastRelay update.
    }
  }

  receive(msg) {
    if (this.closed) return;
    // Until a guest says hello, a host has no one to listen to.
    if (this.role === 'host' && !this.remote && msg.t !== 'hello') return;
    this.lastHeard = performance.now();
    if (this.stale) {
      this.stale = false;
      this.emit('stale', false);
    }
    switch (msg.t) {
      case 'hello':
        if (this.role !== 'host') return;
        if (msg.v !== PROTOCOL_VERSION) {
          this.send({ t: 'refuse', reason: 'version' });
          return;
        }
        this.remote = { name: String(msg.name || 'Guest').slice(0, 16), color: String(msg.color || 'blue') };
        this.send({ t: 'welcome', v: PROTOCOL_VERSION, name: this.profile.name, color: this.profile.color });
        this.startPings();
        this.emit('peer', this.remote);
        return;
      case 'welcome':
        if (this.role !== 'guest') return;
        this.remote = { name: String(msg.name || 'Host').slice(0, 16), color: String(msg.color || 'red') };
        this.startPings();
        this.settle(null, this.remote);
        this.emit('peer', this.remote);
        return;
      case 'refuse':
        this.settle('That race is running a different version of the game. Reload both devices.');
        return;
      case 'ping':
        this.send({ t: 'pong', a: msg.a, b: performance.now() });
        return;
      case 'pong':
        this.clockSample(msg.a, msg.b);
        return;
      case 'bye':
        this.lost('The other player left.');
        return;
      default:
        this.emit('message', msg);
    }
  }

  /** NTP-style offset estimate; keep the lowest-latency samples. */
  clockSample(sent, remoteAt) {
    const now = performance.now();
    const rtt = now - sent;
    this.samples.push({ rtt, offset: remoteAt - (sent + now) / 2 });
    if (this.samples.length > 12) this.samples.shift();
    const best = this.samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
    this.offset = best.offset;
    this.rtt = this.rtt ? this.rtt * 0.8 + rtt * 0.2 : rtt;
  }

  startPings() {
    if (this.timer) return;
    this.lastHeard = performance.now();
    // A quick burst for an initial clock estimate, then a steady heartbeat.
    for (let i = 0; i < 5; i++) setTimeout(() => this.send({ t: 'ping', a: performance.now() }), i * 120);
    this.timer = setInterval(() => {
      this.send({ t: 'ping', a: performance.now() });
      const quiet = performance.now() - this.lastHeard;
      if (!this.stale && quiet > NET.timeoutMs) {
        this.stale = true;
        this.emit('stale', true);
      }
      if (quiet > NET.timeoutMs * 4) this.lost('Connection lost.');
    }, NET.pingIntervalMs);
  }

  /** Local performance.now() of a timestamp on the remote clock. */
  toLocal(remoteMs) {
    return remoteMs - this.offset;
  }

  send(msg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  /** The other player is gone. A host keeps its room open so someone can join again. */
  lost(reason) {
    if (this.closed) return;
    const wasConnected = !!this.remote;
    clearInterval(this.timer);
    this.timer = null;
    this.remote = null;
    this.samples = [];
    if (this.role !== 'host') this.close(false);
    if (wasConnected) this.emit('lost', reason);
  }

  /** The socket to the relay closed or went quiet. */
  dropped() {
    this.detach();
    if (this.closed) return;
    if (this.pending) {
      this.settle(UNREACHABLE);
      return;
    }
    this.lost('Connection lost.');
    if (!this.closed) {
      // A host's room, and so its code, went with the socket.
      this.close(false);
      this.emit('down', 'Lost the connection to the race server.');
    }
  }

  detach() {
    const ws = this.ws;
    this.ws = null;
    if (!ws) return;
    try {
      ws.close();
    } catch {
      // Already closing.
    }
  }

  close(sayBye = true) {
    if (this.closed) return;
    // Anything sent before close() still goes out ahead of the close frame.
    if (sayBye) this.send({ t: 'bye' });
    this.closed = true;
    clearInterval(this.timer);
    clearInterval(this.watchdog);
    this.timer = this.watchdog = null;
    this.detach();
  }
}
