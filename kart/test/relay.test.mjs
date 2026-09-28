// The relay (serve/relay.mjs) and the game's Link (src/net.js) talking to it,
// over real sockets on localhost.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import net from 'node:net';
import { after, before, describe, test } from 'node:test';
import { attachRelay } from '../serve/relay.mjs';
import { CODE_ALPHABET } from '../src/config.js';
import { Link } from '../src/net.js';

let server;
let port;
let relay;

before(async () => {
  server = createServer((req, res) => res.writeHead(404).end());
  relay = attachRelay(server, { keepaliveMs: 150 });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  port = server.address().port;
  // src/net.js builds its relay URL from the page's location.
  globalThis.location = { protocol: 'http:', host: `127.0.0.1:${port}` };
});

after(() => {
  server.closeAllConnections();
  server.close();
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let codes = 0;
const freshCode = () => `T${String(codes++).padStart(3, '0')}`;

/** A browser-style client (Node's built-in WebSocket) that queues JSON messages. */
function client(query) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/net?${query}`);
  const inbox = [];
  const waiting = [];
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.relay === 'ka') return;
    const w = waiting.shift();
    if (w) w(msg);
    else inbox.push(msg);
  };
  const closed = new Promise((r) => ws.addEventListener('close', (e) => r(e.code)));
  return {
    ws,
    closed,
    next: () => (inbox.length ? Promise.resolve(inbox.shift()) : new Promise((r) => waiting.push(r))),
    send: (msg) => ws.send(JSON.stringify(msg)),
  };
}

async function pair() {
  const code = freshCode();
  const host = client(`host=${code}`);
  assert.deepEqual(await host.next(), { relay: 'room' });
  const guest = client(`join=${code}`);
  assert.deepEqual(await guest.next(), { relay: 'paired' });
  return { code, host, guest };
}

/** A hand-driven socket for the framing rules browsers never break. */
async function raw(query) {
  const sock = net.connect(port, '127.0.0.1');
  await once(sock, 'connect');
  sock.write(
    `GET /net?${query} HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
      `Sec-WebSocket-Key: ${randomBytes(16).toString('base64')}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
  );
  let buf = Buffer.alloc(0);
  let upgraded = false;
  const frames = [];
  const waiting = [];
  const ended = new Promise((r) => sock.on('close', r));
  sock.on('data', (d) => {
    buf = Buffer.concat([buf, d]);
    if (!upgraded) {
      const end = buf.indexOf('\r\n\r\n');
      if (end < 0) return;
      assert.match(buf.subarray(0, end).toString(), /^HTTP\/1.1 101/);
      buf = buf.subarray(end + 4);
      upgraded = true;
    }
    // Server frames are unmasked; our payloads stay under 126 bytes.
    while (buf.length >= 2 && buf.length >= 2 + (buf[1] & 0x7f)) {
      const len = buf[1] & 0x7f;
      const frame = { op: buf[0] & 0x0f, payload: buf.subarray(2, 2 + len) };
      buf = buf.subarray(2 + len);
      const w = waiting.shift();
      if (w) w(frame);
      else frames.push(frame);
    }
  });
  const next = () => (frames.length ? Promise.resolve(frames.shift()) : new Promise((r) => waiting.push(r)));
  return {
    sock,
    ended,
    next,
    /** Next frame that isn't the relay's periodic ping or keepalive. */
    async nextReal() {
      for (;;) {
        const f = await next();
        if (f.op === 0x9 || (f.op === 0x1 && f.payload.toString() === '{"relay":"ka"}')) continue;
        return f;
      }
    },
    send: (op, payload, opts) => sock.write(frame(op, payload, opts)),
  };
}

function frame(op, payload, { fin = true, rsv = 0, masked = true, len64 = false } = {}) {
  const len = payload.length;
  const size = len64 || len >= 65536 ? 10 : len >= 126 ? 4 : 2;
  const head = Buffer.alloc(size + (masked ? 4 : 0));
  head[0] = (fin ? 0x80 : 0) | rsv | op;
  if (size === 2) head[1] = len;
  else if (size === 4) {
    head[1] = 126;
    head.writeUInt16BE(len, 2);
  } else {
    head[1] = 127;
    head.writeBigUInt64BE(BigInt(len), 2);
  }
  if (!masked) return Buffer.concat([head, payload]);
  head[1] |= 0x80;
  const mask = randomBytes(4);
  mask.copy(head, size);
  const body = Buffer.from(payload);
  for (let i = 0; i < body.length; i++) body[i] ^= mask[i & 3];
  return Buffer.concat([head, body]);
}

const closeCode = (f) => (assert.equal(f.op, 0x8), f.payload.readUInt16BE(0));

describe('relay rooms', () => {
  test('pairs a host and guest and forwards messages both ways, verbatim', async () => {
    const { host, guest } = await pair();
    guest.send({ t: 'hello', name: 'Zoë 🏎️', n: [1, 2.5, null] });
    assert.deepEqual(await host.next(), { t: 'hello', name: 'Zoë 🏎️', n: [1, 2.5, null] });
    host.send({ t: 'welcome' });
    assert.deepEqual(await guest.next(), { t: 'welcome' });
    host.ws.close();
    guest.ws.close();
  });

  test('turns away a wrong code, a third player, a taken code and junk', async () => {
    const nobody = client(`join=${freshCode()}`);
    assert.deepEqual(await nobody.next(), { relay: 'nohost' });
    assert.equal(await nobody.closed, 4000);

    const { code, host, guest } = await pair();
    const third = client(`join=${code}`);
    assert.deepEqual(await third.next(), { relay: 'full' });
    const twin = client(`host=${code}`);
    assert.deepEqual(await twin.next(), { relay: 'taken' });
    const junk = client('join=../../etc');
    assert.deepEqual(await junk.next(), { relay: 'bad' });

    // The rejected clients left the pair untouched.
    guest.send({ t: 'still-here' });
    assert.deepEqual(await host.next(), { t: 'still-here' });
    host.ws.close();
    guest.ws.close();
  });

  test('when the guest leaves, the host keeps the room for the next guest', async () => {
    const { code, host, guest } = await pair();
    guest.ws.close();
    assert.deepEqual(await host.next(), { relay: 'left' });
    const second = client(`join=${code}`);
    assert.deepEqual(await second.next(), { relay: 'paired' });
    second.send({ t: 'hello' });
    assert.deepEqual(await host.next(), { t: 'hello' });
    host.ws.close();
    second.ws.close();
  });

  test('when the host leaves, the guest is told and the room closes', async () => {
    const { code, host, guest } = await pair();
    host.ws.close();
    assert.deepEqual(await guest.next(), { relay: 'left' });
    await guest.closed;
    await sleep(20);
    assert.equal(relay.rooms.has(code), false);
  });

  test('keeps idle sockets alive and drops silent ones', async () => {
    const { host, guest } = await pair();
    const quiet = await raw(`host=${freshCode()}`);
    assert.equal((await quiet.next()).payload.toString(), '{"relay":"room"}');
    // Browsers answer pings on their own; this raw socket never does.
    await quiet.ended;
    await sleep(400);
    guest.send({ t: 'after-idle' });
    assert.deepEqual(await host.next(), { t: 'after-idle' });
    host.ws.close();
    guest.ws.close();
  });
});

describe('relay framing', () => {
  test('reassembles fragmented messages and handles 16-bit lengths', async () => {
    const code = freshCode();
    const host = client(`host=${code}`);
    assert.deepEqual(await host.next(), { relay: 'room' });
    const guest = await raw(`join=${code}`);
    assert.equal((await guest.nextReal()).payload.toString(), '{"relay":"paired"}');
    const text = JSON.stringify({ t: 'long', pad: 'x'.repeat(1000) });
    const bytes = Buffer.from(text);
    guest.send(0x1, bytes.subarray(0, 300), { fin: false });
    guest.send(0x9, Buffer.from('mid')); // control frames may interleave with fragments
    assert.deepEqual(await guest.nextReal(), { op: 0xa, payload: Buffer.from('mid') });
    guest.send(0x0, bytes.subarray(300, 600), { fin: false });
    guest.send(0x0, bytes.subarray(600));
    assert.deepEqual(await host.next(), JSON.parse(text));
    guest.sock.destroy();
    host.ws.close();
  });

  for (const [what, send, code] of [
    ['an unmasked frame', (c) => c.send(0x1, Buffer.from('{}'), { masked: false }), 1002],
    ['reserved bits', (c) => c.send(0x1, Buffer.from('{}'), { rsv: 0x40 }), 1002],
    ['a binary message', (c) => c.send(0x2, Buffer.from([1, 2, 3])), 1003],
    ['invalid UTF-8', (c) => c.send(0x1, Buffer.from([0x7b, 0xc3, 0x28, 0x7d])), 1007],
    ['a message over the size limit', (c) => c.send(0x1, Buffer.alloc(70000, 0x20), { len64: true }), 1009],
    ['a stray continuation frame', (c) => c.send(0x0, Buffer.from('{}')), 1002],
    ['a fragmented control frame', (c) => c.send(0x9, Buffer.from('x'), { fin: false }), 1002],
    [
      'a flood of messages',
      (c) => c.sock.write(Buffer.concat(Array.from({ length: 200 }, () => frame(0x1, Buffer.from('{}'))))),
      1008,
    ],
  ]) {
    test(`closes the connection on ${what}`, async () => {
      const c = await raw(`host=${freshCode()}`);
      await c.nextReal(); // room
      send(c);
      assert.equal(closeCode(await c.nextReal()), code);
      await c.ended;
    });
  }

  test('answers a close frame and hangs up', async () => {
    const c = await raw(`host=${freshCode()}`);
    await c.nextReal();
    const payload = Buffer.alloc(2);
    payload.writeUInt16BE(1000);
    c.send(0x8, payload);
    assert.equal(closeCode(await c.nextReal()), 1000);
    await c.ended;
  });

  test('survives a malformed request line', async () => {
    const sock = net.connect(port, '127.0.0.1');
    await once(sock, 'connect');
    sock.write('GET http://[bad HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
    sock.resume(); // read the 400 so the close comes through
    await once(sock, 'close');
    const ok = client(`host=${freshCode()}`);
    assert.deepEqual(await ok.next(), { relay: 'room' });
    ok.ws.close();
  });

  test('refuses plain requests and other paths', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/net`);
    assert.equal(res.status, 404); // the test server's own handler: not an upgrade
    const sock = net.connect(port, '127.0.0.1');
    await once(sock, 'connect');
    sock.write('GET /other HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
    const [reply] = await once(sock, 'data');
    assert.match(reply.toString(), /^HTTP\/1.1 404/);
    sock.destroy();
  });
});

describe('game link through the relay', () => {
  const profile = (name, color) => ({ name, color });
  const settled = (p) =>
    p.then(
      (value) => ({ value }),
      (error) => ({ error: error.message }),
    );

  test('codes use the same alphabet as the relay accepts', () => {
    assert.match(CODE_ALPHABET, /^[A-Z0-9]+$/);
  });

  test('host and guest pair, sync clocks, exchange messages and part cleanly', async () => {
    const host = new Link(profile('Ana', 'red'));
    const guest = new Link(profile('Ben', 'blue'));
    const hostEvents = [];
    host.on('peer', (p) => hostEvents.push(['peer', p.name]));
    host.on('lost', (r) => hostEvents.push(['lost', r]));
    const got = [];
    host.on('message', (m) => got.push(m));

    const code = await host.host();
    assert.match(code, new RegExp(`^[${CODE_ALPHABET}]{4}$`));
    const remote = await guest.join(code);
    assert.deepEqual(remote, { name: 'Ana', color: 'red' });
    await sleep(700); // the opening ping burst
    assert.ok(guest.samples.length >= 3 && Math.abs(guest.offset) < 50, `clock offset ${guest.offset}`);
    assert.ok(host.connected && guest.connected);
    assert.deepEqual(hostEvents, [['peer', 'Ben']]);

    guest.send({ t: 's', id: 7, x: 1.5 });
    await sleep(50);
    assert.deepEqual(got, [{ t: 's', id: 7, x: 1.5 }]);

    guest.close();
    await sleep(100);
    assert.deepEqual(hostEvents, [
      ['peer', 'Ben'],
      ['lost', 'The other player left.'],
    ]);
    assert.equal(host.connected, false);
    assert.equal(host.closed, false, 'the host keeps its room');

    // A new guest can use the same code.
    const again = new Link(profile('Cy', 'green'));
    assert.deepEqual(await again.join(code), { name: 'Ana', color: 'red' });
    again.close();
    host.close();
  });

  test('a wrong code, a full room and an unreachable server read clearly', async () => {
    const wrong = await settled(new Link(profile('X', 'red')).join('ZZZZ'));
    assert.match(wrong.error, /No race found with code ZZZZ/);

    const host = new Link(profile('Ana', 'red'));
    const code = await host.host();
    const guest = new Link(profile('Ben', 'blue'));
    await guest.join(code);
    const third = await settled(new Link(profile('Cy', 'green')).join(code));
    assert.equal(third.error, 'That race already has two players.');

    const saved = globalThis.location;
    globalThis.location = { protocol: 'http:', host: '127.0.0.1:1' };
    const offline = await settled(new Link(profile('Dee', 'red')).host());
    globalThis.location = saved;
    assert.match(offline.error, /Can't reach the race server/);

    guest.close();
    host.close();
  });

  test('a host that loses the relay reports it, and its guest is told', async () => {
    const host = new Link(profile('Ana', 'red'));
    const guest = new Link(profile('Ben', 'blue'));
    const events = [];
    host.on('lost', () => events.push('host lost guest'));
    host.on('down', (r) => events.push(`host down: ${r}`));
    guest.on('lost', (r) => events.push(`guest lost host: ${r}`));
    await guest.join(await host.host());
    // Cut the host's socket at the relay, as a dead network would.
    for (const c of relay.conns) if (relay.rooms.get(host.code)?.host === c) c.socket.destroy();
    await sleep(100);
    assert.deepEqual(events.sort(), [
      'guest lost host: The other player left.',
      'host down: Lost the connection to the race server.',
      'host lost guest',
    ]);
    assert.ok(host.closed && guest.closed);
  });

  test('a version mismatch is refused', async () => {
    const host = new Link(profile('Ana', 'red'));
    const code = await host.host();
    const guest = new Link(profile('Old', 'blue'));
    guest.control = function (what) {
      if (what === 'paired') this.send({ t: 'hello', v: 0, name: 'Old' });
      else Link.prototype.control.call(this, what);
    };
    const result = await settled(guest.join(code));
    assert.match(result.error, /different version/);
    host.close();
  });
});
