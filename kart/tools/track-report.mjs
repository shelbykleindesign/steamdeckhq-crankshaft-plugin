// Prints circuit stats and writes an SVG plan view. Usage:
//   node tools/track-report.mjs [out.svg]
import { writeFileSync } from 'node:fs';
import { TRACK } from '../src/config.js';
import { Track } from '../src/track.js';

const track = new Track();
const n = track.count;

let minR = Infinity;
let minRAt = 0;
for (let i = 0; i < n; i++) {
  const r = 1 / Math.max(1e-9, Math.abs(track.curv[i]));
  if (r < minR) {
    minR = r;
    minRAt = i;
  }
}

// Closest approach between parts of the centerline that are far apart along the loop.
let minSep = Infinity;
let sepA = 0;
let sepB = 0;
const skip = Math.ceil(80 / track.spacing);
for (let i = 0; i < n; i += 2) {
  for (let j = 0; j < n; j += 2) {
    const along = Math.min(Math.abs(i - j), n - Math.abs(i - j));
    if (along < skip) continue;
    const d = Math.hypot(track.px[i] - track.px[j], track.pz[i] - track.pz[j]);
    if (d < minSep) {
      minSep = d;
      sepA = i;
      sepB = j;
    }
  }
}

console.log(`length        ${track.length.toFixed(1)} m (${n} samples)`);
console.log(`min radius    ${minR.toFixed(1)} m at s=${(minRAt * track.spacing).toFixed(0)}`);
console.log(
  `min separation ${minSep.toFixed(1)} m between s=${sepA} and s=${sepB} (walls need > ${(2 * TRACK.wallOffset).toFixed(1)})`,
);
console.log(`bounds        ${JSON.stringify(track.bounds())}`);

const out = process.argv[2];
if (out) {
  const b = track.bounds();
  const pad = 30;
  const w = b.maxX - b.minX + pad * 2;
  const h = b.maxZ - b.minZ + pad * 2;
  const pts = (lat) => {
    const a = [];
    for (let i = 0; i < n; i += 2) {
      const f = track.frameAt(i * track.spacing, lat);
      a.push(`${(f.x - b.minX + pad).toFixed(1)},${(f.z - b.minZ + pad).toFixed(1)}`);
    }
    return a.join(' ');
  };
  const s0 = track.frameAt(0);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w * 3}" height="${h * 3}">
<rect width="100%" height="100%" fill="#4a9c4a"/>
<polygon points="${pts(-TRACK.wallOffset)}" fill="none" stroke="#c33" stroke-width="0.8"/>
<polygon points="${pts(TRACK.wallOffset)}" fill="none" stroke="#c33" stroke-width="0.8"/>
<polygon points="${pts(0)}" fill="none" stroke="#333" stroke-width="${TRACK.roadHalfWidth * 2}" stroke-linejoin="round"/>
<polygon points="${pts(0)}" fill="none" stroke="#fff" stroke-width="0.4" stroke-dasharray="3 3"/>
<circle cx="${s0.x - b.minX + pad}" cy="${s0.z - b.minZ + pad}" r="3" fill="#fff"/>
<line x1="${s0.x - b.minX + pad}" y1="${s0.z - b.minZ + pad}" x2="${s0.x - b.minX + pad + s0.tx * 20}" y2="${s0.z - b.minZ + pad + s0.tz * 20}" stroke="#ff0" stroke-width="2"/>
${track.pads
  .map((p) => {
    const f = track.frameAt(p.s, p.lat);
    return `<circle cx="${f.x - b.minX + pad}" cy="${f.z - b.minZ + pad}" r="2.5" fill="#fa0"/>`;
  })
  .join('\n')}
</svg>`;
  writeFileSync(out, svg);
  console.log(`wrote ${out}`);
}
