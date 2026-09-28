# Tilt Kart

A first-person kart racer for iPad. Hold the iPad like a steering wheel and turn it to steer. The view counter-rotates against the turn, so the horizon stays level with the real ground and the on-screen steering wheel stays glued to the glass: the iPad _is_ the wheel. The camera never pitches, so the view always looks straight ahead, parallel to the track.

Race a CPU rival solo, or race another person online: one device hosts and shows a four-letter code, the other types it in.

Live at **<https://moto.shelbyklein.com>**, served from the Beelink. `public/` is the whole site: plain static files, with the built bundle committed. `serve/` runs it.

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

- Turn on **Rotation Lock** in Control Center. On iPad it locks whichever orientation you're holding, so a hard turn can't flip the screen to portrait. The game also survives an accidental auto-rotate mid-race, because steering is measured against the orientation you started the race in.
- **Share → Add to Home Screen** runs it full screen with no Safari toolbars.
- Settings has a live steering meter, a sensitivity slider ("full lock at N°" of rotation, default 28°), a _Level horizon_ toggle, and a _Set current hold as centre_ button for players who naturally hold the iPad slightly turned.

## Hosting (Beelink)

Safari only gives motion-sensor access to pages served over **HTTPS**. On the Beelink, `serve/docker-compose.yml` runs nginx for `public/` next to `cloudflared`, which connects the dedicated `moto` Cloudflare Tunnel. That tunnel routes `moto.shelbyklein.com` to `http://web:80` on the compose network. Cloudflare supplies the certificate, and nothing is exposed on the router or the host.

Over SSH, one line clones the game (first time) and starts or updates everything:

```sh
git clone -q --depth 1 -b claude/kart-accelerometer-steering-yry610 https://github.com/shelbykleindesign/steamdeckhq-crankshaft-plugin ~/tilt-kart 2>/dev/null; ~/tilt-kart/kart/serve/up.sh
```

`up.sh` pulls the latest files, fetches the tunnel token with this machine's `cloudflared` login into `serve/.env` (mode 600) the first time, and runs `docker compose up -d`. If `cloudflared` isn't logged in, it says how to fix that. Re-run it to deploy updates. `npm run build` stamps `game.js` and `style.css` in `index.html` with a content hash (`?v=…`), and `index.html` is never cached. So players get a new version on their next load, even though Cloudflare lets browsers keep those files for hours.

The tunnel, its route and the DNS record live in Cloudflare (Zero Trust → Networks → Tunnels → `moto`), so nothing about the domain is configured on the Beelink.

To try changes on a real iPad before deploying, tunnel the dev server to get a temporary HTTPS URL:

```sh
npm install
npm run dev                                         # rebuilds on save, serves public/ on :8080
cloudflared tunnel --url http://localhost:8080      # or: npx localtunnel --port 8080
```

## Online play

Pairing uses [PeerJS](https://peerjs.com). The host registers the ID `tiltkart-v1-<CODE>` on PeerJS's free public signaling server. The guest looks that ID up, and the two devices then talk directly over WebRTC. If a network blocks direct connections (common on cellular), they fall back to PeerJS's public TURN relay. There is no game server to run.

Each device simulates its own kart and sends its state 20 times a second. The other side draws it 110 ms in the past and interpolates, which keeps it smooth. The green light is synchronised with an NTP-style clock estimate, so both countdowns hit GO at the same moment.

The public signaling server has no uptime guarantee. To run your own:

```sh
npm run peer-server        # PeerJS server on port 9000
```

Then open the game on both devices with `?peerhost=<server-ip>&peerport=9000&peersecure=0`. A page served over HTTPS can only reach a signaling server that also uses HTTPS/WSS. For that, pass `--sslkey`/`--sslcert` to `peerjs` or put it behind a reverse proxy, and drop `peersecure=0`.

## Development

```sh
npm install
npm run dev          # watch + serve on :8080
npm run build        # production bundle -> public/game.js (commit it)
npm test             # unit tests: steering math, track geometry, physics, laps
npm run track        # circuit stats (length, tightest corner, clearances)
```

Browser tests (Playwright; run `npx playwright install chromium` once):

```sh
npx http-server public -p 8080 &     # serve the built game
npm run peer-server &                # local signaling server for the online test
npm run test:e2e
```

- `test/e2e/tilt.mjs` feeds real `devicemotion` events to an emulated landscape iPad, using both the iOS and the spec gravity sign. It checks that a clockwise turn steers right, and that the horizon the camera projects counter-rotates by exactly the device angle. With _Level horizon_ off, it checks the view stays screen-aligned.
- `test/e2e/online.mjs` pairs two browsers with a code, rejects a wrong code, and checks the green light fires at the same moment on both. The two karts then race to the finish, both devices must show the same results, a rematch must carry state again, and the host must be told when the guest quits.

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
| `src/net.js`                         | Pairing codes, WebRTC link, clock sync, heartbeat                             |
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
- Online play depends on the public PeerJS server unless you self-host it (above).
- The iPad itself has no vibration API, so there is no haptic feedback.

Third-party code bundled into `public/game.js` (three.js, PeerJS and their dependencies) is listed with its licenses in `public/third-party-licenses.txt`, regenerated on every build.
