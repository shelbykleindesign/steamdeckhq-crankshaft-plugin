# Tilt Kart

A first-person kart racer for iPad. Hold the iPad like a steering wheel and turn it to steer. The view counter-rotates against the turn, so the horizon stays level with the real ground and the on-screen steering wheel stays glued to the glass: the iPad _is_ the wheel. The camera never pitches, so the view always looks straight ahead, parallel to the track.

Race a CPU rival solo, or race another person online: one device hosts and shows a four-letter code, the other types it in.

Live at **<https://moto.shelbyklein.com>**, served from the Beelink. `public/` is the whole site: plain static files, with the built bundle committed. `serve/` runs it, including the small relay that pairs online players.

## Controls

| Action                    | iPad                                                                                   | Keyboard (desktop testing) |
| ------------------------- | -------------------------------------------------------------------------------------- | -------------------------- |
| Steer                     | Turn the iPad like a wheel                                                             | ← → or A D                 |
| Accelerate                | Automatic                                                                              | Automatic                  |
| Brake / reverse           | Hold left thumb on the screen                                                          | ↓ or S                     |
| Drift                     | Hold right thumb while turning; let go for a mini-turbo (sparks: blue → orange → pink) | Space or Shift             |
| Pause / recentre steering | ❚❚ button, top left                                                                    | –                          |

Lap count (1, 3 or 5) is in Settings, and in the lobby when hosting.

Yellow chevron pads give a boost. Grass slows you down.

**Tips for iPad**

- Turn on **Rotation Lock** in Control Center. On iPad it locks whichever orientation you're holding, so a hard turn can't make iPadOS spin the screen to portrait. Without it, a hard turn in Safari will spin the page. The game turns the race straight back (see `src/hold.js`), so steering and the horizon carry on, but you see the spin. The first time it happens, the game shows a Rotation Lock tip.
- **Share → Add to Home Screen** runs it full screen with no Safari toolbars, and stays in landscape: the app manifest asks for landscape, which iPadOS honours for Home Screen apps.
- Settings has a live steering meter, a sensitivity slider ("full lock at N°" of rotation, default 28°), a _Level horizon_ toggle, and a _Set current hold as centre_ button for players who naturally hold the iPad slightly turned.

## Hosting (Beelink)

Safari only gives motion-sensor access to pages served over **HTTPS**, so a page opened over `http://` sends itself to `https://` (local addresses excepted). On the Beelink, `serve/docker-compose.yml` runs four services:

- **web**: nginx serving `public/`, and passing `/net` through to the relay.
- **relay**: `serve/relay.mjs` on Node, which pairs online players (see [Online play](#online-play)).
- **updater**: pulls this branch every minute, so pushed changes to the game go live without logging in (`serve/update.sh`).
- **tunnel**: `cloudflared`, connecting the dedicated `moto` Cloudflare Tunnel, which routes `moto.shelbyklein.com` to `http://web:80` on the compose network.

Cloudflare supplies the certificate, and nothing is exposed on the router or the host.

Over SSH, one line clones the game (first time) and starts or updates everything:

```sh
git clone -q --depth 1 -b claude/kart-accelerometer-steering-yry610 https://github.com/shelbykleindesign/steamdeckhq-crankshaft-plugin ~/tilt-kart 2>/dev/null; ~/tilt-kart/kart/serve/up.sh
```

`up.sh` pulls the latest files, fetches the tunnel token with this machine's `cloudflared` login into `serve/.env` (mode 600) the first time, and runs `docker compose up -d`. If `cloudflared` isn't logged in, it says how to fix that.

After that, deploying is just pushing to the branch: the updater fast-forwards the checkout within a minute, and nginx serves the new files on the next page load (`docker compose logs updater` shows what it pulled). Changes inside `serve/` (the nginx config, the relay, the compose file) only take effect when you re-run `./up.sh`, which restarts the services that use them. `npm run build` stamps `game.js` and `style.css` in `index.html` with a content hash (`?v=…`), and `index.html` is never cached. So players get a new version on their next load, even though Cloudflare lets browsers keep those files for hours.

The tunnel, its route and the DNS record live in Cloudflare (Zero Trust → Networks → Tunnels → `moto`), so nothing about the domain is configured on the Beelink.

To try changes on a real iPad before deploying, tunnel the dev server to get a temporary HTTPS URL:

```sh
npm install
npm run dev                                         # rebuilds on save, serves public/ on :8080
cloudflared tunnel --url http://localhost:8080      # or: npx localtunnel --port 8080
```

## Online play

Both devices connect to the relay on the Beelink (`serve/relay.mjs`) over a WebSocket at `wss://moto.shelbyklein.com/net`: the same host and connection that served the page. So online play works on any network that can load the game, cellular included, with no third-party servers. The host opens a room under a random four-letter code, the guest joins it by code, and the relay passes their messages along. A third player gets "That race already has two players". When the guest leaves, the host keeps the code for the next one.

Each device simulates its own kart and sends its state 20 times a second. The other side draws it 110 ms in the past and interpolates, which keeps it smooth. The green light is synchronised with an NTP-style clock estimate over the relay, so both countdowns hit GO at the same moment.

The relay is one file with no dependencies: a minimal WebSocket server on Node's `http` module, with limits on rooms, message size and rate. It sends a keepalive every 20 s so Cloudflare and nginx don't drop a quiet lobby.

## Development

```sh
npm install
npm run dev          # rebuild on save + serve public/ and the relay on :8080
npm run serve        # serve the committed build and the relay on :8080
npm run build        # production bundle -> public/game.js (commit it)
npm test             # unit tests: steering math, track geometry, physics, laps, relay
npm run track        # circuit stats (length, tightest corner, clearances)
```

Browser tests (Playwright; run `npx playwright install chromium` once). They serve the committed build and the relay themselves; set `KART_URL` to point them at a running deployment instead:

```sh
npm run test:e2e
```

- `test/e2e/tilt.mjs` feeds real `devicemotion` events to an emulated landscape iPad, using both the iOS and the spec gravity sign. It checks that a clockwise turn steers right, and that the horizon the camera projects counter-rotates by exactly the device angle. With _Level horizon_ off, it checks the view stays screen-aligned. It then turns the emulated iPad to portrait mid-race, as iPadOS does in a hard corner. The race must stay drawn in landscape, turned back the way the iPad turned, with the horizon still level; menus must follow the device again.
- `test/e2e/online.mjs` pairs two browsers with a code, rejects a wrong code and a third player, and checks the green light fires at the same moment on both. The two karts then race to the finish, both devices must show the same results, a rematch must carry state again, and the host must be told when the guest quits.
- `test/relay.test.mjs` covers the relay directly (rooms, keepalives, and the WebSocket framing rules browsers never break) and the game's `Link` talking to it.

URL flags:

- `?sim`: the arrow keys rotate a _virtual_ iPad, driving the same steering and horizon-lock path as the real sensor. Use it to see the effect on a desktop.
- `?debug`: live readout of frame rate, sensor angles, the detected gravity sign and network round-trip.

### Where things live

| File                                 | What it does                                                                  |
| ------------------------------------ | ----------------------------------------------------------------------------- |
| `src/tilt.js`                        | Accelerometer → device roll; steering curve; iOS permission and sign handling |
| `src/view.js`                        | Renderer and cameras. First-person camera: pitch 0, roll = −device roll       |
| `src/kart.js`                        | Arcade physics: grip and slide, drift and mini-turbo, walls, boost pads       |
| `src/track.js`                       | The circuit (a closed spline) and track-relative queries                      |
| `src/world.js` / `src/kart-model.js` | Procedural environment and kart meshes (no image assets)                      |
| `src/net.js`                         | Pairing codes, the link through the relay, clock sync, heartbeat              |
| `src/hold.js`                        | Holds a race in its orientation when iPadOS rotates the page mid-corner       |
| `serve/relay.mjs`                    | The online relay: rooms by code, WebSocket server, no dependencies            |
| `src/main.js`                        | Screens, race flow, snapshot interpolation, results                           |
| `src/config.js`                      | All tuning numbers: speeds, grip, steering, camera, network rates             |

### How the steering works

`devicemotion` reports acceleration including gravity. Rotated into the frame of the UI as displayed, the gravity vector's angle in the screen plane is the device's roll about its screen normal. It stays accurate however far the iPad is tipped back, until it is nearly flat, where the game blends to a tilt-style reading. That one angle drives:

- **steering**: deadzone and response curve, full lock at the sensitivity angle;
- **the camera**: rolls by exactly the opposite angle, so the horizon holds level;
- **the steering wheel**: turned by the same angle, so it appears fixed to the screen.

iOS reports gravity with the opposite sign to the W3C spec (and to Android). The game works out the sign from how the device is being held rather than trusting the platform.

## Known limits

- Two players per online race.
- Online races go through the Beelink, so the two devices can't race if it's down (the page wouldn't load either).
- The iPad itself has no vibration API, so there is no haptic feedback.

Third-party code bundled into `public/game.js` (three.js) is listed with its license in `public/third-party-licenses.txt`, regenerated on every build.
