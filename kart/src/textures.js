// Procedural canvas textures, so the game ships without image assets.

import * as THREE from 'three';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

// Small deterministic PRNG so textures look the same on both devices.
export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function finish(c, { repeat = true, srgb = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

function speckle(ctx, w, h, count, colors, rand, size = 2) {
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = colors[Math.floor(rand() * colors.length)];
    ctx.fillRect(rand() * w, rand() * h, size * (0.5 + rand()), size * (0.5 + rand()));
  }
}

/** Asphalt with painted edge lines; u runs across the road, v along it. */
export function asphaltTexture() {
  const W = 256;
  const H = 512;
  const [c, ctx] = canvas(W, H);
  const r = rng(7);
  ctx.fillStyle = '#4a4f57';
  ctx.fillRect(0, 0, W, H);
  speckle(ctx, W, H, 9000, ['#3f444b', '#565b63', '#5e636b', '#43484f'], r, 2);
  // Subtle darker racing line down the middle third.
  const g = ctx.createLinearGradient(0, 0, W, 0);
  g.addColorStop(0.3, 'rgba(0,0,0,0)');
  g.addColorStop(0.5, 'rgba(0,0,0,0.10)');
  g.addColorStop(0.7, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // Edge lines.
  ctx.fillStyle = '#f2f2f2';
  const lw = Math.round(W * 0.018);
  const inset = Math.round(W * 0.012);
  ctx.fillRect(inset, 0, lw, H);
  ctx.fillRect(W - inset - lw, 0, lw, H);
  return finish(c);
}

/** Mown-lawn stripes; repeated in world space. */
export function grassTexture() {
  const S = 256;
  const [c, ctx] = canvas(S, S);
  const r = rng(3);
  ctx.fillStyle = '#5fbf4a';
  ctx.fillRect(0, 0, S, S / 2);
  ctx.fillStyle = '#53b03f';
  ctx.fillRect(0, S / 2, S, S / 2);
  speckle(ctx, S, S, 2500, ['#4ea63b', '#68c653', '#5ab846', '#4a9d38'], r, 2);
  return finish(c);
}

export function checkerTexture(cols = 8, rows = 2, a = '#111', b = '#fafafa') {
  const cell = 32;
  const [c, ctx] = canvas(cols * cell, rows * cell);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      ctx.fillStyle = (x + y) % 2 ? a : b;
      ctx.fillRect(x * cell, y * cell, cell, cell);
    }
  }
  const t = finish(c, { repeat: false });
  t.magFilter = THREE.NearestFilter;
  return t;
}

/** Forward-pointing chevrons for boost pads (v runs along travel). */
export function chevronTexture() {
  const W = 128;
  const H = 256;
  const [c, ctx] = canvas(W, H);
  ctx.fillStyle = '#ffd400';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#ff6a00';
  for (let i = 0; i < 2; i++) {
    const y = i * (H / 2);
    ctx.beginPath();
    ctx.moveTo(W * 0.5, y + H * 0.08);
    ctx.lineTo(W * 0.95, y + H * 0.36);
    ctx.lineTo(W * 0.95, y + H * 0.48);
    ctx.lineTo(W * 0.5, y + H * 0.2);
    ctx.lineTo(W * 0.05, y + H * 0.48);
    ctx.lineTo(W * 0.05, y + H * 0.36);
    ctx.closePath();
    ctx.fill();
  }
  return finish(c);
}

/** Corner warning board: white arrows on red. */
export function arrowSignTexture() {
  const W = 256;
  const H = 96;
  const [c, ctx] = canvas(W, H);
  ctx.fillStyle = '#e8322e';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < 3; i++) {
    const x = 40 + i * 70;
    ctx.beginPath();
    ctx.moveTo(x, 14);
    ctx.lineTo(x + 34, H / 2);
    ctx.lineTo(x, H - 14);
    ctx.lineTo(x - 16, H - 14);
    ctx.lineTo(x + 18, H / 2);
    ctx.lineTo(x - 16, 14);
    ctx.closePath();
    ctx.fill();
  }
  return finish(c, { repeat: false });
}

/** Start gantry banner. */
export function bannerTexture(text) {
  const W = 1024;
  const H = 128;
  const [c, ctx] = canvas(W, H);
  ctx.fillStyle = '#15181d';
  ctx.fillRect(0, 0, W, H);
  // Checker strips top and bottom.
  const cell = 16;
  for (let x = 0; x < W / cell; x++) {
    for (let y = 0; y < 1; y++) {
      ctx.fillStyle = x % 2 ? '#fafafa' : '#15181d';
      ctx.fillRect(x * cell, 0, cell, cell);
      ctx.fillStyle = x % 2 ? '#15181d' : '#fafafa';
      ctx.fillRect(x * cell, H - cell, cell, cell);
    }
  }
  ctx.fillStyle = '#ffd400';
  ctx.font = 'italic 900 68px ui-rounded, "SF Pro Rounded", "Arial Rounded MT Bold", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, W / 2, H / 2 + 3);
  return finish(c, { repeat: false });
}

/** Floating name tag above a rival kart. */
export function nameTagTexture(name, color) {
  const W = 512;
  const H = 128;
  const [c, ctx] = canvas(W, H);
  ctx.font = '800 64px ui-rounded, "SF Pro Rounded", system-ui, sans-serif';
  const tw = Math.min(W - 40, ctx.measureText(name).width + 64);
  const x = (W - tw) / 2;
  ctx.fillStyle = 'rgba(12,14,18,0.78)';
  roundRect(ctx, x, 16, tw, H - 32, 44);
  ctx.fill();
  ctx.fillStyle = color;
  roundRect(ctx, x + 14, H / 2 - 10, 20, 20, 10);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(name, x + 46, H / 2 + 3, tw - 60);
  return finish(c, { repeat: false });
}

/** Soft round blob for kart shadows. */
export function shadowTexture() {
  const S = 128;
  const [c, ctx] = canvas(S, S);
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(0,0,0,0.55)');
  g.addColorStop(0.6, 'rgba(0,0,0,0.35)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  return finish(c, { repeat: false, srgb: false });
}

/** Glowing dot used for spark particles. */
export function sparkTexture() {
  const S = 64;
  const [c, ctx] = canvas(S, S);
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.8)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  return finish(c, { repeat: false, srgb: false });
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
