// Tilt Kart relay: pairs two players by code and passes their messages along.
//
// Runs on the Beelink next to nginx, which forwards wss://moto.shelbyklein.com/net
// here (see docker-compose.yml). Because it rides the same HTTPS connection that
// serves the page, online races work on any network that can load the game.
// No dependencies: a minimal WebSocket server (RFC 6455) on Node's http module.
//
//   node serve/relay.mjs     listen on :8787 (or $PORT); GET /healthz reports rooms
//
// A host opens /net?host=CODE and a guest opens /net?join=CODE. Once both are in,
// every text message is forwarded verbatim to the other player. The relay only
// speaks for itself in messages with a "relay" field:
//   room    (host)  the code is yours; wait for a guest
//   taken   (host)  someone already has that code; pick another
//   busy    (host)  the relay is at its room limit
//   paired  (guest) you're in with the host
//   nohost  (guest) no room with that code
//   full    (guest) the room already has a guest
//   left            the other player disconnected (a host keeps its room)
//   ka              keepalive every 20 s, so proxies don't drop an idle socket

import { isUtf8 } from 'node:buffer';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const CODE = /^[A-Z0-9]{3,12}$/;

const DEFAULTS = {
  path: '/net',
  keepaliveMs: 20_000,
  maxRooms: 500,
  maxMessage: 16 * 1024, // bytes; game messages are well under 1 KB
  maxRate: 120, // messages per second before a client is cut off (the game sends ~25)
  log: () => {},
};

/** One WebSocket connection: frame parsing and writing, nothing game-specific. */
class Conn {
  constructor(socket, { maxMessage, maxRate }) {
    this.socket = socket;
    this.maxMessage = maxMessage;
    this.maxRate = maxRate;
    this.buf = Buffer.alloc(0);
    this.parts = null; // payloads of a fragmented message in progress
    this.partsLen = 0;
    this.binary = false;
    this.open = true;
    this.alive = true; // heard from since the last keepalive round
    this.second = 0;
    this.count = 0; // messages received in the current second
    this.onmessage = null;
    this.onclose = null;
    socket.setNoDelay(true);
    socket.on('data', (d) => this.data(d));
    socket.on('error', () => socket.destroy());
    socket.on('close', () => this.ended());
  }

  data(chunk) {
    this.alive = true;
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    while (this.open && this.frame());
  }

  /** Consume one frame from the buffer. False when it needs more bytes, or closed. */
  frame() {
    const b = this.buf;
    if (b.length < 2) return false;
    const fin = (b[0] & 0x80) !== 0;
    const op = b[0] & 0x0f;
    // Clients must mask, and no extensions are negotiated, so the RSV bits stay clear.
    if (b[0] & 0x70 || !(b[1] & 0x80)) return this.fail(1002);
    let len = b[1] & 0x7f;
    let at = 2;
    if (len === 126) {
      if (b.length < 4) return false;
      len = b.readUInt16BE(2);
      at = 4;
    } else if (len === 127) {
      if (b.length < 10) return false;
      if (b.readUInt32BE(2) !== 0) return this.fail(1009);
      len = b.readUInt32BE(6);
      at = 10;
    }
    if (len > this.maxMessage) return this.fail(1009);
    if (b.length < at + 4 + len) return false;
    const payload = Buffer.allocUnsafe(len);
    for (let i = 0; i < len; i++) payload[i] = b[at + 4 + i] ^ b[at + (i & 3)];
    this.buf = b.subarray(at + 4 + len);

    if (op >= 0x8) {
      // Control frames are never fragmented and carry at most 125 bytes.
      if (!fin || len > 125) return this.fail(1002);
      if (op === 0x8) return this.fail(1000); // answer a close and hang up
      if (op === 0x9) this.write(0xa, payload);
      else if (op !== 0xa) return this.fail(1002);
      return true;
    }
    if (op === 0x0) {
      if (!this.parts) return this.fail(1002);
    } else if (op === 0x1 || op === 0x2) {
      if (this.parts) return this.fail(1002);
      this.parts = [];
      this.partsLen = 0;
      this.binary = op === 0x2;
    } else {
      return this.fail(1002);
    }
    this.parts.push(payload);
    this.partsLen += len;
    if (this.partsLen > this.maxMessage) return this.fail(1009);
    if (!fin) return true;
    const msg = this.parts.length === 1 ? this.parts[0] : Buffer.concat(this.parts);
    this.parts = null;
    if (this.binary) return this.fail(1003);
    if (!isUtf8(msg)) return this.fail(1007);
    if (this.flooding()) return this.fail(1008);
    this.onmessage?.(msg);
    return this.open;
  }

  flooding() {
    const second = Math.floor(performance.now() / 1000);
    if (second !== this.second) {
      this.second = second;
      this.count = 0;
    }
    return ++this.count > this.maxRate;
  }

  write(op, payload) {
    if (!this.open || this.socket.destroyed) return;
    const len = payload.length;
    const head = Buffer.allocUnsafe(len < 126 ? 2 : len < 65536 ? 4 : 10);
    head[0] = 0x80 | op;
    if (len < 126) {
      head[1] = len;
    } else if (len < 65536) {
      head[1] = 126;
      head.writeUInt16BE(len, 2);
    } else {
      head[1] = 127;
      head.writeBigUInt64BE(BigInt(len), 2);
    }
    this.socket.cork();
    this.socket.write(head);
    this.socket.write(payload);
    this.socket.uncork();
    // A client that stops reading must not make us buffer without limit.
    if (this.socket.writableLength > 1 << 20) this.socket.destroy();
  }

  send(obj) {
    this.write(0x1, Buffer.from(JSON.stringify(obj)));
  }

  /** Forward a message exactly as it arrived. */
  forward(msg) {
    this.write(0x1, msg);
  }

  ping() {
    this.write(0x9, Buffer.alloc(0));
  }

  /** Send a close frame, hang up, and give the other end a moment to finish. */
  close(code = 1000) {
    if (!this.open) return;
    const payload = Buffer.allocUnsafe(2);
    payload.writeUInt16BE(code, 0);
    this.write(0x8, payload);
    this.open = false;
    this.socket.end();
    setTimeout(() => this.socket.destroy(), 1000).unref();
    this.ended();
  }

  fail(code) {
    this.close(code);
    return false;
  }

  ended() {
    this.open = false;
    const cb = this.onclose;
    this.onclose = this.onmessage = null;
    cb?.();
  }
}

/** Answer WebSocket upgrades on `path` for an existing http.Server. */
export function attachRelay(server, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const { log } = opts;
  const rooms = new Map(); // code -> { host, guest }
  const conns = new Set();

  server.on('upgrade', (req, socket, head) => {
    let url;
    try {
      url = new URL(req.url, 'http://relay');
    } catch {
      return refuse(socket, '400 Bad Request');
    }
    if (url.pathname !== opts.path) return refuse(socket, '404 Not Found');
    const key = req.headers['sec-websocket-key'];
    if (String(req.headers.upgrade).toLowerCase() !== 'websocket' || !key) return refuse(socket, '400 Bad Request');
    if (req.headers['sec-websocket-version'] !== '13') {
      return refuse(socket, '426 Upgrade Required', 'Sec-WebSocket-Version: 13\r\n');
    }
    const accept = createHash('sha1')
      .update(key + GUID)
      .digest('base64');
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    const conn = new Conn(socket, opts);
    conns.add(conn);
    enter(conn, url.searchParams);
    if (head.length) conn.data(head);
  });

  function enter(conn, params) {
    const hosting = params.get('host');
    const code = hosting ?? params.get('join');
    conn.onclose = () => conns.delete(conn);
    if (!code || !CODE.test(code)) return turnAway(conn, 'bad');

    if (hosting !== null) {
      if (rooms.has(code)) return turnAway(conn, 'taken');
      if (rooms.size >= opts.maxRooms) return turnAway(conn, 'busy');
      const room = { host: conn, guest: null };
      rooms.set(code, room);
      conn.onmessage = (msg) => room.guest?.forward(msg);
      conn.onclose = () => {
        conns.delete(conn);
        rooms.delete(code);
        const guest = room.guest;
        room.guest = null;
        if (guest) {
          guest.send({ relay: 'left' });
          guest.close();
        }
        log(`room ${code} closed (${rooms.size} open)`);
      };
      conn.send({ relay: 'room' });
      log(`room ${code} opened (${rooms.size} open)`);
      return;
    }

    const room = rooms.get(code);
    if (!room) return turnAway(conn, 'nohost');
    if (room.guest) return turnAway(conn, 'full');
    room.guest = conn;
    conn.onmessage = (msg) => room.host.forward(msg);
    conn.onclose = () => {
      conns.delete(conn);
      if (room.guest !== conn) return;
      room.guest = null;
      room.host.send({ relay: 'left' });
      log(`room ${code}: guest left`);
    };
    conn.send({ relay: 'paired' });
    log(`room ${code}: guest joined`);
  }

  function turnAway(conn, reason) {
    conn.send({ relay: reason });
    conn.close(4000);
  }

  // Ping everyone; drop anyone who stayed silent (not even a pong) since last time.
  const timer = setInterval(() => {
    for (const conn of conns) {
      if (!conn.alive) {
        conn.socket.destroy();
        continue;
      }
      conn.alive = false;
      conn.ping();
      conn.send({ relay: 'ka' });
    }
  }, opts.keepaliveMs);
  timer.unref();
  server.on('close', () => clearInterval(timer));

  return { rooms, conns };
}

function refuse(socket, status, extra = '') {
  socket.end(`HTTP/1.1 ${status}\r\n${extra}Connection: close\r\nContent-Length: 0\r\n\r\n`);
}

/** Standalone relay, as run in the Beelink's relay container. */
export function startRelay({ port = Number(process.env.PORT) || 8787, host = '0.0.0.0', log } = {}) {
  const server = createServer((req, res) => {
    if (req.url === '/healthz') {
      res.end(`ok, ${relay.rooms.size} rooms open\n`);
      return;
    }
    res.statusCode = req.url.startsWith(DEFAULTS.path) ? 426 : 404;
    res.end();
  });
  const relay = attachRelay(server, { log });
  server.listen(port, host);
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const stamp = (msg) => console.log(`${new Date().toISOString()} ${msg}`);
  const server = startRelay({ log: stamp });
  server.on('listening', () => stamp(`relay listening on :${server.address().port}`));
  // PID 1 in a container gets no default signal handling, so exit explicitly.
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => process.exit(0));
}
