// Builds the static environment around a Track: sky, ground, road, curbs,
// barriers, start gantry, boost pads, signs and scenery.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GAME_NAME, RACE, TRACK } from './config.js';
import * as TX from './textures.js';

export const PALETTE = {
  skyTop: '#2f7fd8',
  horizon: '#cfe6f7',
  groundFog: '#9fcf8e',
  curbRed: '#e8322e',
  curbWhite: '#f4f4f4',
  wallA: '#e8322e',
  wallB: '#f4f4f4',
  ink: '#15181d',
};

export function buildWorld(track) {
  const scene = new THREE.Scene();
  const horizon = new THREE.Color(PALETTE.horizon);
  scene.background = horizon;
  scene.fog = new THREE.Fog(horizon, 160, 1400);

  const hemi = new THREE.HemisphereLight('#e4f1ff', '#5d8446', 1.6);
  const sun = new THREE.DirectionalLight('#fff1dc', 2.4);
  sun.position.set(-0.55, 0.75, -0.35).multiplyScalar(100);
  scene.add(hemi, sun);

  const sky = buildSky(sun.position.clone().normalize());
  scene.add(sky);
  scene.add(buildGround());
  scene.add(buildRoad(track));
  scene.add(buildCurbs(track));
  scene.add(buildWalls(track));
  scene.add(buildStart(track));
  scene.add(buildGrandstand(track));
  const pads = buildPads(track);
  scene.add(pads.group);
  scene.add(buildSigns(track));
  scene.add(buildTrees(track));
  scene.add(buildMountains(track));
  scene.add(buildClouds(track));

  return {
    scene,
    sky,
    update(time, cameraPos) {
      pads.texture.offset.y = -((time * 2.2) % 1);
      sky.position.copy(cameraPos);
    },
  };
}

// ---------------------------------------------------------------------------

function buildSky(sunDir) {
  const geo = new THREE.SphereGeometry(1800, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(PALETTE.skyTop) },
      horizon: { value: new THREE.Color(PALETTE.horizon) },
      bottom: { value: new THREE.Color(PALETTE.groundFog) },
      sunDir: { value: sunDir },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 top;
      uniform vec3 horizon;
      uniform vec3 bottom;
      uniform vec3 sunDir;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float y = d.y;
        vec3 c = y > 0.0
          ? mix(horizon, top, pow(smoothstep(0.0, 0.55, y), 0.75))
          : mix(horizon, bottom, smoothstep(0.0, -0.08, y));
        float s = max(dot(d, normalize(sunDir)), 0.0);
        c += vec3(1.0, 0.92, 0.75) * (pow(s, 600.0) * 2.0 + pow(s, 14.0) * 0.16);
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = -1;
  mesh.frustumCulled = false;
  return mesh;
}

function buildGround() {
  const tex = TX.grassTexture();
  const size = 6000;
  tex.repeat.set(size / 18, size / 18);
  // Subdivided: one giant quad interpolates depth too coarsely near the camera
  // and pokes through the road on some GPUs.
  const geo = new THREE.PlaneGeometry(size, size, 60, 60);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex }));
  mesh.position.y = -0.02;
  return mesh;
}

/**
 * Ribbon along the centerline between two lateral offsets. `colorAt(s)` gives
 * per-segment flat colours; otherwise UVs are generated for a texture.
 */
function ribbon(track, latA, latB, y, { from = 0, to = track.count, vScale = 1 / 16, colorAt = null } = {}) {
  const pos = [];
  const uv = [];
  const col = [];
  const c = new THREE.Color();
  const n = track.count;
  for (let i = from; i < to; i++) {
    const s0 = i * track.spacing;
    const s1 = (i + 1) * track.spacing;
    const a0 = track.frameAt(s0, latA);
    const b0 = track.frameAt(s0, latB);
    const a1 = track.frameAt(s1, latA);
    const b1 = track.frameAt(s1, latB);
    const ya = typeof y === 'function' ? y(0) : y;
    const yb = typeof y === 'function' ? y(1) : y;
    // Two triangles, wound so the face points up.
    pos.push(a0.x, ya, a0.z, b0.x, yb, b0.z, a1.x, ya, a1.z);
    pos.push(b0.x, yb, b0.z, b1.x, yb, b1.z, a1.x, ya, a1.z);
    const v0 = s0 * vScale;
    const v1 = s1 * vScale;
    uv.push(0, v0, 1, v0, 0, v1, 1, v0, 1, v1, 0, v1);
    if (colorAt) {
      c.set(colorAt(s0, i % n));
      for (let k = 0; k < 6; k++) col.push(c.r, c.g, c.b);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (colorAt) geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  // Make sure faces point up regardless of which side latA is on.
  if (latA > latB) flipWinding(geo);
  geo.computeVertexNormals();
  return geo;
}

/** Layered ground decals: pull each layer toward the camera in depth. */
function decal(layer) {
  return { polygonOffset: true, polygonOffsetFactor: -layer, polygonOffsetUnits: -4 * layer };
}

function flipWinding(geo) {
  const p = geo.attributes.position.array;
  const u = geo.attributes.uv.array;
  const c = geo.attributes.color ? geo.attributes.color.array : null;
  for (let t = 0; t < p.length / 9; t++) {
    const i1 = t * 3 + 1;
    const i2 = t * 3 + 2;
    for (let k = 0; k < 3; k++) [p[i1 * 3 + k], p[i2 * 3 + k]] = [p[i2 * 3 + k], p[i1 * 3 + k]];
    for (let k = 0; k < 2; k++) [u[i1 * 2 + k], u[i2 * 2 + k]] = [u[i2 * 2 + k], u[i1 * 2 + k]];
    if (c) for (let k = 0; k < 3; k++) [c[i1 * 3 + k], c[i2 * 3 + k]] = [c[i2 * 3 + k], c[i1 * 3 + k]];
  }
}

function buildRoad(track) {
  const hw = TRACK.roadHalfWidth;
  // Winding: with right = (-tz, tx), going from -hw (left) to +hw (right) along
  // travel produces counter-clockwise triangles seen from above.
  const geo = ribbon(track, -hw, hw, 0.02, { vScale: 1 / 16 });
  const mat = new THREE.MeshLambertMaterial({ map: TX.asphaltTexture(), ...decal(1) });
  return new THREE.Mesh(geo, mat);
}

function buildCurbs(track) {
  const hw = TRACK.roadHalfWidth;
  const cw = TRACK.curbWidth;
  // Curbs only where the road bends, extended a little either side.
  const n = track.count;
  const want = new Uint8Array(n);
  const ext = Math.round(14 / track.spacing);
  for (let i = 0; i < n; i++) {
    if (Math.abs(track.curv[i]) > 1 / 110) for (let k = -ext; k <= ext; k++) want[(i + k + n) % n] = 1;
  }
  const geos = [];
  const colorAt = (s) => (Math.floor(s / 2) % 2 ? PALETTE.curbRed : PALETTE.curbWhite);
  let i = 0;
  while (i < n) {
    if (!want[i]) {
      i++;
      continue;
    }
    const start = i;
    while (i < n && want[i]) i++;
    for (const [a, b] of [
      [hw, hw + cw],
      [-hw - cw, -hw],
    ]) {
      geos.push(ribbon(track, a, b, 0.035, { from: start, to: i, colorAt }));
    }
  }
  const geo = mergeGeometries(geos);
  return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, ...decal(1) }));
}

function buildWalls(track) {
  const off = TRACK.wallOffset;
  const h = 1.05;
  const pos = [];
  const col = [];
  const cA = new THREE.Color(PALETTE.wallA);
  const cB = new THREE.Color(PALETTE.wallB);
  const cap = new THREE.Color('#2a2f36');
  const n = track.count;
  for (const side of [-1, 1]) {
    for (let i = 0; i < n; i++) {
      const s0 = i * track.spacing;
      const s1 = (i + 1) * track.spacing;
      const a = track.frameAt(s0, side * off);
      const b = track.frameAt(s1, side * off);
      const c = Math.floor(s0 / 3) % 2 ? cA : cB;
      // Panel
      quad(pos, col, a.x, a.z, b.x, b.z, 0, h - 0.12, c);
      // Dark top rail
      quad(pos, col, a.x, a.z, b.x, b.z, h - 0.12, h, cap);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
}

function quad(pos, col, x0, z0, x1, z1, y0, y1, c) {
  pos.push(x0, y0, z0, x1, y0, z1, x1, y1, z1, x0, y0, z0, x1, y1, z1, x0, y1, z0);
  for (let k = 0; k < 6; k++) col.push(c.r, c.g, c.b);
}

function buildStart(track) {
  const g = new THREE.Group();
  const f = track.frameAt(0);
  const hw = TRACK.roadHalfWidth;

  // Checkered line across the road.
  const line = new THREE.Mesh(
    new THREE.PlaneGeometry(hw * 2, 2.4),
    new THREE.MeshLambertMaterial({ map: TX.checkerTexture(16, 2), ...decal(2) }),
  );
  line.geometry.rotateX(-Math.PI / 2);
  line.position.set(f.x, 0.03, f.z);
  line.rotation.y = f.heading;
  g.add(line);

  // Grid slots.
  const slotMat = new THREE.MeshBasicMaterial({ color: '#f4f4f4', ...decal(2) });
  for (const lat of [-RACE.gridLateral, RACE.gridLateral]) {
    for (const back of [RACE.gridBack - 1.4, RACE.gridBack + 1.8]) {
      const p = track.frameAt(-back, lat);
      const bar = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.22), slotMat);
      bar.geometry.rotateX(-Math.PI / 2);
      bar.position.set(p.x, 0.03, p.z);
      bar.rotation.y = p.heading;
      g.add(bar);
    }
  }

  // Gantry.
  const ink = new THREE.MeshLambertMaterial({ color: PALETTE.ink });
  const span = hw + 3;
  for (const side of [-1, 1]) {
    const p = track.frameAt(0, side * span);
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.8, 7, 0.8), ink);
    pillar.position.set(p.x, 3.5, p.z);
    pillar.rotation.y = f.heading;
    g.add(pillar);
  }
  const bannerTex = TX.bannerTexture(GAME_NAME.toUpperCase());
  const bannerMat = new THREE.MeshLambertMaterial({ map: bannerTex });
  const banner = new THREE.Mesh(new THREE.BoxGeometry(span * 2 + 0.8, 1.8, 0.5), [
    ink,
    ink,
    ink,
    ink,
    bannerMat,
    bannerMat,
  ]);
  banner.position.set(f.x, 6.4, f.z);
  banner.rotation.y = f.heading;
  g.add(banner);
  return g;
}

function buildGrandstand(track) {
  // Outside of the start straight (left of travel).
  const g = new THREE.Group();
  const crowdTex = crowdTexture();
  const length = 64;
  const f = track.frameAt(-10, -(TRACK.wallOffset + 9));
  const seats = new THREE.MeshLambertMaterial({ map: crowdTex });
  const frame = new THREE.MeshLambertMaterial({ color: '#d9dde3' });
  const roof = new THREE.MeshLambertMaterial({ color: '#1e6bff' });
  const stand = new THREE.Group();
  for (let r = 0; r < 6; r++) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(length, 0.9, 1.6), [frame, frame, frame, frame, seats, frame]);
    step.position.set(0, 0.45 + r * 0.9, -r * 1.6);
    stand.add(step);
  }
  const back = new THREE.Mesh(new THREE.BoxGeometry(length, 7, 0.5), frame);
  back.position.set(0, 3.5, -9.5);
  stand.add(back);
  const top = new THREE.Mesh(new THREE.BoxGeometry(length + 2, 0.4, 11), roof);
  top.position.set(0, 8.2, -4.8);
  top.rotation.x = -0.08;
  stand.add(top);
  for (let i = 0; i <= 4; i++) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.35, 8, 0.35), frame);
    post.position.set(-length / 2 + (i * length) / 4, 4, 0.6);
    stand.add(post);
  }
  // Face the stand toward the track: its local +Z must point along the track's
  // right vector (cos h, -sin h), which a yaw of h + 90° achieves.
  stand.position.set(f.x, 0, f.z);
  stand.rotation.y = f.heading + Math.PI / 2;
  g.add(stand);
  return g;
}

function crowdTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 32;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#3a4150';
  ctx.fillRect(0, 0, 512, 32);
  const r = TX.rng(11);
  const colors = ['#ff3b30', '#ffd400', '#1e6bff', '#ffffff', '#1fbf5a', '#ff7a1a', '#8c4bff', '#f2c6a0'];
  for (let x = 4; x < 512; x += 9) {
    ctx.fillStyle = colors[Math.floor(r() * colors.length)];
    ctx.beginPath();
    ctx.arc(x + r() * 3, 12 + r() * 6, 3.4, 0, Math.PI * 2);
    ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.repeat.set(6, 1);
  return t;
}

function buildPads(track) {
  const texture = TX.chevronTexture();
  texture.repeat.set(1, 2);
  const mat = new THREE.MeshBasicMaterial({ map: texture, ...decal(2) });
  const group = new THREE.Group();
  for (const p of track.pads) {
    const f = track.frameAt(p.s, p.lat);
    const geo = new THREE.PlaneGeometry(p.halfWidth * 2, p.halfLen * 2);
    geo.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(f.x, 0.04, f.z);
    m.rotation.y = f.heading;
    group.add(m);
  }
  return { group, texture };
}

/** Local curvature peaks tighter than `maxR`. */
export function findCorners(track, maxR = 45) {
  const n = track.count;
  const corners = [];
  const win = Math.round(30 / track.spacing);
  for (let i = 0; i < n; i++) {
    const c = Math.abs(track.curv[i]);
    if (c < 1 / maxR) continue;
    let peak = true;
    for (let k = -win; k <= win && peak; k++) if (Math.abs(track.curv[(i + k + n) % n]) > c) peak = false;
    if (peak && !corners.some((o) => Math.abs(track.deltaS(o.s, i * track.spacing)) < 40)) {
      corners.push({ s: i * track.spacing, dir: Math.sign(track.curv[i]) });
    }
  }
  return corners;
}

function buildSigns(track) {
  const g = new THREE.Group();
  const tex = TX.arrowSignTexture();
  const matR = new THREE.MeshLambertMaterial({ map: tex });
  const texL = tex.clone();
  texL.wrapS = THREE.RepeatWrapping;
  texL.repeat.x = -1;
  texL.needsUpdate = true;
  const matL = new THREE.MeshLambertMaterial({ map: texL });
  const post = new THREE.MeshLambertMaterial({ color: '#2a2f36' });
  for (const c of findCorners(track)) {
    // Board on the outside wall at the apex, facing drivers on the approach.
    const outside = c.dir > 0 ? 1 : -1; // left turn: outside is on the right
    const at = track.frameAt(c.s, outside * (TRACK.wallOffset + 0.6));
    const approach = track.frameAt(c.s - 25);
    const board = new THREE.Mesh(new THREE.PlaneGeometry(5, 1.6), c.dir > 0 ? matL : matR);
    board.position.set(at.x, 2.1, at.z);
    board.rotation.y = approach.heading;
    g.add(board);
    for (const dx of [-2, 2]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.15, 2.9, 0.15), post);
      p.position.set(at.x + Math.cos(approach.heading) * dx, 1.45, at.z - Math.sin(approach.heading) * dx);
      g.add(p);
    }
  }
  return g;
}

function buildTrees(track) {
  const r = TX.rng(21);
  const b = track.bounds();
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  const spots = [];
  const cell = 11;
  for (let x = b.minX - 260; x < b.maxX + 260; x += cell) {
    for (let z = b.minZ - 260; z < b.maxZ + 260; z += cell) {
      const px = x + (r() - 0.5) * cell;
      const pz = z + (r() - 0.5) * cell;
      const d = track.distanceTo(px, pz);
      if (d < TRACK.wallOffset + 5) continue;
      // Denser just beyond the barriers and in the far ring, sparse between.
      const far = Math.hypot(px - cx, pz - cz);
      const p = d < 40 ? 0.22 : far > 300 ? 0.55 : 0.1;
      if (r() < p) spots.push([px, pz, 0.8 + r() * 0.7, r()]);
    }
  }
  // Keep the start straight's grandstand side clear.
  const standF = track.frameAt(-10, -(TRACK.wallOffset + 9));
  const clear = spots.filter(([x, z]) => Math.hypot(x - standF.x, z - standF.z) > 40);

  const pines = clear.filter((s) => s[3] < 0.55);
  const rounds = clear.filter((s) => s[3] >= 0.55);
  const trunkGeo = new THREE.CylinderGeometry(0.25, 0.35, 2.2, 5);
  trunkGeo.translate(0, 1.1, 0);
  const pineGeo = new THREE.ConeGeometry(2.2, 6.5, 6);
  pineGeo.translate(0, 5, 0);
  const roundGeo = new THREE.IcosahedronGeometry(2.6, 0);
  roundGeo.translate(0, 4.3, 0);

  const g = new THREE.Group();
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: '#7a5230' }), clear.length);
  const pineMesh = new THREE.InstancedMesh(pineGeo, new THREE.MeshLambertMaterial({ flatShading: true }), pines.length);
  const roundMesh = new THREE.InstancedMesh(
    roundGeo,
    new THREE.MeshLambertMaterial({ flatShading: true }),
    rounds.length,
  );
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const col = new THREE.Color();
  const greens = ['#2e8b3e', '#3a9b47', '#257a35', '#46a650', '#2f7f3a'];
  clear.forEach(([x, z, s, k], i) => {
    q.setFromAxisAngle(up, k * 40);
    m.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(s, s, s));
    trunks.setMatrixAt(i, m);
  });
  const place = (mesh, list) =>
    list.forEach(([x, z, s, k], i) => {
      q.setFromAxisAngle(up, k * 40);
      m.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(s, s * (0.9 + k * 0.3), s));
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, col.set(greens[Math.floor(k * 997) % greens.length]));
    });
  place(pineMesh, pines);
  place(roundMesh, rounds);
  g.add(trunks, pineMesh, roundMesh);
  return g;
}

function buildMountains(track) {
  const b = track.bounds();
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  const r = TX.rng(5);
  const hazy = (hex, k) => new THREE.Color(hex).lerp(new THREE.Color(PALETTE.horizon), k);
  const rock = new THREE.MeshLambertMaterial({ color: hazy('#6a8aa3', 0.5), flatShading: true, fog: false });
  const snow = new THREE.MeshLambertMaterial({ color: hazy('#ffffff', 0.25), flatShading: true, fog: false });
  const g = new THREE.Group();
  const count = 30;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + r() * 0.15;
    const dist = 1400 + r() * 250;
    const h = 70 + r() * 170;
    const rad = h * (1.6 + r() * 0.8);
    const x = cx + Math.cos(a) * dist;
    const z = cz + Math.sin(a) * dist;
    const m = new THREE.Mesh(new THREE.ConeGeometry(rad, h, 7), rock);
    m.position.set(x, h / 2 - 2, z);
    m.rotation.y = r() * Math.PI;
    g.add(m);
    if (h > 170) {
      const capH = h * 0.28;
      const cap = new THREE.Mesh(new THREE.ConeGeometry(rad * 0.28 * 1.02, capH, 7), snow);
      cap.position.set(x, h - capH / 2 - 2 + 0.5, z);
      cap.rotation.y = m.rotation.y;
      g.add(cap);
    }
  }
  return g;
}

function buildClouds(track) {
  const b = track.bounds();
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  const r = TX.rng(9);
  const mat = new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#c9dcee', flatShading: true, fog: false });
  const parts = [];
  for (let i = 0; i < 16; i++) {
    const a = r() * Math.PI * 2;
    const dist = 450 + r() * 800;
    const x = cx + Math.cos(a) * dist;
    const z = cz + Math.sin(a) * dist;
    const y = 170 + r() * 140;
    const puffs = 4 + Math.floor(r() * 4);
    for (let k = 0; k < puffs; k++) {
      const s = 18 + r() * 22;
      const geo = new THREE.IcosahedronGeometry(s, 1);
      geo.scale(1.6, 0.55, 1);
      geo.translate(x + (k - puffs / 2) * s * 1.2 + r() * 10, y + r() * 8, z + (r() - 0.5) * 30);
      parts.push(geo);
    }
  }
  return new THREE.Mesh(mergeGeometries(parts), mat);
}
