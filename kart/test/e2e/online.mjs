// End-to-end check of online play: two browser pages pair with a code, race,
// finish, rematch, and one leaves. Needs:
//   npm run build && npx http-server public -p 8080   (static files)
//   npm run peer-server                                (local signaling on :9000)
//   node test/e2e/online.mjs
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const BASE = process.env.KART_URL || 'http://localhost:8080/';
const URL = `${BASE}?peerhost=localhost&peerport=9000&peersecure=0`;
const SHOTS = process.env.KART_SHOTS || '';

const browser = await chromium.launch({
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    // Same-machine WebRTC: use plain host candidates instead of mDNS names.
    '--disable-features=WebRtcHideLocalIpsWithMdns',
  ],
});
// Small viewports keep two software-rendered pages fast enough in CI.
const viewport = { width: Number(process.env.KART_W) || 560, height: Number(process.env.KART_H) || 400 };
const hostCtx = await browser.newContext({ viewport });
const guestCtx = await browser.newContext({ viewport });
const host = await hostCtx.newPage();
const guest = await guestCtx.newPage();
for (const [name, p] of [
  ['host', host],
  ['guest', guest],
]) {
  p.on('pageerror', (e) => console.log(`[${name} pageerror] ${e.message}`));
  p.on('console', (m) => m.type() === 'error' && console.log(`[${name} console] ${m.text()}`));
}

const screen = (p) => p.evaluate(() => document.body.dataset.screen);
const waitScreen = (p, name, timeout = 20000) =>
  p.waitForFunction((n) => document.body.dataset.screen === n, name, { timeout });
const shot = async (p, name) => SHOTS && p.screenshot({ path: `${SHOTS}/${name}.png` });
const step = (msg) => console.log(`✓ ${msg}`);

await host.goto(URL);
await guest.goto(URL);

// Host creates a race code.
await host.click('[data-action=host]');
await host.waitForFunction(() => /^[A-Z]{4}$/.test(document.getElementById('host-code').textContent), null, {
  timeout: 20000,
});
const code = await host.evaluate(() => document.getElementById('host-code').textContent);
await host.click('[data-laps="1"]');
step(`host registered code ${code}`);
await shot(host, 'online-01-host-code');

// A wrong code fails with a clear message.
await guest.click('[data-action=join]');
await guest.fill('#join-code', 'ZZZZ');
await guest.click('[data-action=join-go]');
await guest.waitForFunction(() => document.getElementById('join-status').dataset.tone === 'bad', null, {
  timeout: 20000,
});
const err = await guest.evaluate(() => document.getElementById('join-status').textContent);
assert.match(err, /No race found with code ZZZZ/);
step(`bad code rejected: "${err}"`);
await shot(guest, 'online-02-bad-code');

// Guest joins with the right code (typed in lowercase to check normalisation).
await guest.fill('#join-code', code.toLowerCase());
await guest.click('[data-action=join-go]');
await waitScreen(guest, 'lobby');
await host.waitForFunction(() => !document.getElementById('btn-host-start').disabled, null, { timeout: 10000 });
step('guest joined; host can start');
await shot(host, 'online-03-host-ready');
await shot(guest, 'online-04-guest-lobby');

// Start: both enter the race with a synchronised green light.
await host.click('[data-action=host-start]');
await waitScreen(host, 'race');
await waitScreen(guest, 'race');
const [goH, goG, offset] = await Promise.all([
  host.evaluate(() => window.__kart.race.goAt + performance.timeOrigin),
  guest.evaluate(() => window.__kart.race.goAt + performance.timeOrigin),
  guest.evaluate(() => window.__kart.link.offset),
]);
console.log(
  `  green light skew between devices: ${Math.abs(goH - goG).toFixed(1)} ms (clock offset ${offset.toFixed(0)} ms)`,
);
assert.ok(Math.abs(goH - goG) < 60, 'both devices start together');
step('race started on both devices');

// Let the CPU drive both karts once the lights go green.
await host.waitForFunction(() => window.__kart.race.phase === 'racing', null, { timeout: 10000 });
await guest.waitForFunction(() => window.__kart.race.phase === 'racing', null, { timeout: 10000 });
await host.evaluate(() => window.__kart.autopilot(1));
await guest.evaluate(() => window.__kart.autopilot(0.9));
await host.waitForTimeout(6000);
const seen = await Promise.all(
  [host, guest].map((p) =>
    p.evaluate(() => {
      const r = window.__kart.race;
      const pose = r.rival.pose;
      return {
        snaps: r.rival.snaps.length,
        rivalDist: r.rival.dist,
        me: r.me.kart.dist,
        pose: pose && [pose.x, pose.z],
      };
    }),
  ),
);
console.log('  host sees', JSON.stringify(seen[0]), '\n  guest sees', JSON.stringify(seen[1]));
assert.ok(seen[0].snaps > 5 && seen[1].snaps > 5, 'state snapshots flow both ways');
assert.ok(Math.abs(seen[0].rivalDist - seen[1].me) < 20, "host's view of the guest tracks the guest");
step('karts see each other');
await shot(host, 'online-05-host-racing');
await shot(guest, 'online-06-guest-racing');

// Both finish a 1-lap race and see results.
await waitScreen(host, 'results', 150000);
await waitScreen(guest, 'results', 150000);
await host.waitForFunction(() => !document.getElementById('btn-rematch').disabled, null, { timeout: 60000 });
const table = await Promise.all(
  [host, guest].map((p) => p.evaluate(() => document.getElementById('res-table').innerText.replace(/\s+/g, ' '))),
);
console.log('  host results:', table[0], '\n  guest results:', table[1]);
step('both finished; results shown');
await shot(host, 'online-07-host-results');
await shot(guest, 'online-08-guest-results');

// Rematch from the host restarts both, and state flows again (packets from the
// previous race must not poison the new one).
await host.click('[data-action=rematch]');
await waitScreen(host, 'race');
await waitScreen(guest, 'race');
await host.waitForFunction(() => window.__kart.race.phase === 'racing', null, { timeout: 15000 });
await guest.waitForFunction(() => window.__kart.race.phase === 'racing', null, { timeout: 15000 });
await host.evaluate(() => window.__kart.autopilot(1));
await guest.evaluate(() => window.__kart.autopilot(1));
await host.waitForFunction(() => window.__kart.race.rival.snaps.length > 3, null, { timeout: 30000 });
await guest.waitForFunction(() => window.__kart.race.rival.snaps.length > 3, null, { timeout: 30000 });
const rematchRt = await host.evaluate(() => window.__kart.race.rival.snaps.at(-1).rt);
assert.ok(rematchRt < 60, `rematch snapshots belong to the new race (rt ${rematchRt})`);
step('rematch started on both; state flowing');

// Guest quits mid-race: host carries on alone and is told.
await guest.click('[data-action=pause]');
await guest.click('[data-action=quit]');
await waitScreen(guest, 'title');
await host.waitForFunction(() => window.__kart.race.rival.left === true, null, { timeout: 15000 });
step('guest left; host notified');
await shot(host, 'online-09-host-after-leave');

assert.equal(await screen(host), 'race');
await browser.close();
console.log('All online checks passed.');
