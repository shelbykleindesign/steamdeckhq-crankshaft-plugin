// Peer-to-peer link between two devices, paired with a short code.
//
// The host registers the peer ID PEER_PREFIX + CODE on a PeerJS signaling
// server; the guest connects to that ID. After the WebRTC handshake all game
// traffic flows directly between the two devices (or via TURN when a direct
// path isn't possible). No game server is involved.
//
// Override the signaling server with URL params, e.g. for a self-hosted
// `npx peerjs --port 9000`:  ?peerhost=192.168.1.20&peerport=9000&peersecure=0

import { Peer } from 'peerjs';
import { CODE_ALPHABET, CODE_LENGTH, NET, PEER_PREFIX, PROTOCOL_VERSION } from './config.js';

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

function peerOptions() {
  const q = new URLSearchParams(location.search);
  const opts = { debug: q.has('netdebug') ? 2 : 0 };
  const host = q.get('peerhost');
  if (host) {
    opts.host = host;
    opts.secure = q.get('peersecure') !== '0';
    opts.port = Number(q.get('peerport')) || (opts.secure ? 443 : 80);
    opts.path = q.get('peerpath') || '/';
  }
  return opts;
}

function describe(err, code) {
  const type = err && err.type;
  switch (type) {
    case 'peer-unavailable':
      return `No race found with code ${code}. Check the letters, and make sure the host's screen still shows the code.`;
    case 'browser-incompatible':
      return "This browser can't do online play (WebRTC is unavailable).";
    case 'network':
    case 'socket-error':
    case 'socket-closed':
    case 'server-error':
      return "Can't reach the pairing server. Check your internet connection and try again.";
    case 'unavailable-id':
      return 'Could not create a race code. Try again.';
    case 'webrtc':
      return 'The two devices could not connect. Try again, or put both on the same Wi-Fi.';
    default:
      return `Connection problem${type ? ` (${type})` : ''}. Try again.`;
  }
}

export class Link {
  constructor(profile) {
    this.profile = profile; // { name, color }
    this.peer = null;
    this.conn = null;
    this.role = null;
    this.code = null;
    this.remote = null; // { name, color }
    this.offset = 0; // remote clock minus local clock (ms)
    this.rtt = 0;
    this.samples = [];
    this.lastHeard = 0;
    this.stale = false;
    this.timer = null;
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
    return !!(this.conn && this.conn.open && this.remote);
  }

  /** Register a fresh code. Resolves with the code once the server accepts it. */
  host() {
    this.role = 'host';
    return new Promise((resolve, reject) => {
      let attempts = 0;
      const attempt = () => {
        const code = makeCode();
        const peer = new Peer(PEER_PREFIX + code, peerOptions());
        let opened = false;
        peer.on('open', () => {
          opened = true;
          this.peer = peer;
          this.code = code;
          resolve(code);
        });
        peer.on('connection', (conn) => this.incoming(conn));
        peer.on('disconnected', () => {
          // Lost the signaling socket. Existing P2P links keep working; reconnect
          // so a new guest can still find us while we wait in the lobby.
          setTimeout(() => {
            if (this.closed || this.peer !== peer || peer.destroyed || !peer.disconnected) return;
            try {
              peer.reconnect();
            } catch {
              // Destroyed in the meantime.
            }
          }, 1000);
        });
        peer.on('error', (err) => {
          if (!opened) {
            peer.destroy();
            if (err.type === 'unavailable-id' && attempts++ < 5) attempt();
            else reject(new Error(describe(err, code)));
          } else if (err.type !== 'peer-unavailable') {
            this.emit('warning', describe(err, code));
          }
        });
      };
      attempt();
    });
  }

  incoming(conn) {
    if (this.conn && this.conn.open) {
      conn.on('open', () => {
        conn.send({ t: 'full' });
        setTimeout(() => conn.close(), 500);
      });
      return;
    }
    this.attach(conn);
  }

  /** Connect to a host's code. Resolves with the host's profile. */
  join(code) {
    this.role = 'guest';
    this.code = code;
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (message) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.close(false);
        reject(new Error(message));
      };
      const timeout = setTimeout(
        () => fail("Couldn't connect. Check the code, and that both devices are online."),
        NET.connectTimeoutMs,
      );
      this.onWelcome = (remote) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(remote);
      };
      this.onRefused = fail;
      const peer = new Peer(peerOptions());
      this.peer = peer;
      peer.on('open', () => {
        const conn = peer.connect(PEER_PREFIX + code, { reliable: true, serialization: 'json' });
        this.attach(conn);
        conn.on('open', () => {
          conn.send({ t: 'hello', v: PROTOCOL_VERSION, name: this.profile.name, color: this.profile.color });
        });
      });
      peer.on('error', (err) => {
        if (!settled) fail(describe(err, code));
        else if (err.type !== 'peer-unavailable') this.emit('warning', describe(err, code));
      });
    });
  }

  attach(conn) {
    this.conn = conn;
    // A host can see several connections over its lifetime; ignore stale ones.
    const current = () => this.conn === conn;
    conn.on('data', (msg) => current() && this.receive(msg));
    conn.on('close', () => current() && this.lost('The other player left.'));
    conn.on('error', () => current() && this.lost('Connection lost.'));
    conn.on('iceStateChanged', (state) => {
      if (current() && (state === 'failed' || state === 'closed')) this.lost('Connection lost.');
    });
  }

  receive(msg) {
    if (!msg || typeof msg !== 'object' || this.closed) return;
    this.lastHeard = performance.now();
    if (this.stale) {
      this.stale = false;
      this.emit('stale', false);
    }
    switch (msg.t) {
      case 'hello':
        if (this.role !== 'host') return;
        if (msg.v !== PROTOCOL_VERSION) {
          this.conn.send({ t: 'refuse', reason: 'version' });
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
        if (this.onWelcome) this.onWelcome(this.remote);
        this.emit('peer', this.remote);
        return;
      case 'refuse':
        if (this.onRefused)
          this.onRefused('That race is running a different version of the game. Reload both devices.');
        return;
      case 'full':
        if (this.onRefused) this.onRefused('That race already has two players.');
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
    if (!this.conn || !this.conn.open) return;
    try {
      this.conn.send(msg);
    } catch {
      // The channel can close between the check and the send.
    }
  }

  lost(reason) {
    if (this.closed) return;
    const wasConnected = !!this.remote;
    if (this.role === 'host') {
      // Keep the code alive so someone can join again.
      clearInterval(this.timer);
      this.timer = null;
      this.remote = null;
      this.samples = [];
      const conn = this.conn;
      this.conn = null;
      if (conn) conn.close();
    } else {
      this.close(false);
    }
    if (wasConnected) this.emit('lost', reason);
  }

  close(sayBye = true) {
    if (this.closed) return;
    if (sayBye) this.send({ t: 'bye' });
    this.closed = true;
    clearInterval(this.timer);
    this.timer = null;
    const peer = this.peer;
    const conn = this.conn;
    // Let the goodbye flush before tearing down.
    setTimeout(
      () => {
        try {
          if (conn) conn.close();
        } catch {
          // ignore
        }
        try {
          if (peer) peer.destroy();
        } catch {
          // ignore
        }
      },
      sayBye ? 150 : 0,
    );
  }
}
