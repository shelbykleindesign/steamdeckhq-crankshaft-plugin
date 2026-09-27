// Bundles src/ into public/game.js. public/ is the whole site (the Beelink
// serves it via serve/), so the built bundle is committed.
//   npm run build        production bundle (+ third-party license notices)
//   npm run dev          rebuild on change + serve public/ on :8080
import * as esbuild from 'esbuild';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const serve = process.argv.includes('--serve');

const ctx = await esbuild.context({
  entryPoints: ['src/main.js'],
  bundle: true,
  format: 'esm',
  // iPadOS 15 is the oldest Safari with the WebGL2 three.js needs.
  target: ['safari15', 'chrome100', 'firefox100'],
  minify: !serve,
  sourcemap: serve ? 'inline' : false,
  metafile: true,
  outfile: 'public/game.js',
  logLevel: 'info',
});

if (serve) {
  await ctx.watch();
  const { port } = await ctx.serve({ servedir: 'public', port: 8080, host: '0.0.0.0' });
  console.log(`Serving public/ on http://localhost:${port}`);
  console.log('Motion sensors need HTTPS on iPad: tunnel this port or deploy (see README).');
} else {
  const result = await ctx.rebuild();
  await ctx.dispose();
  writeNotices(result.metafile);
}

/** Collect the license text of every npm package that ended up in the bundle. */
function writeNotices(metafile) {
  // eventemitter3 is inlined inside peerjs's own dist, so it never shows up as an input.
  const pkgs = new Set(['eventemitter3']);
  for (const file of Object.keys(metafile.inputs)) {
    const m = file.match(/node_modules\/((?:@[^/]+\/)?[^/]+)\//);
    if (m) pkgs.add(m[1]);
  }
  const sections = [...pkgs].sort().map((name) => {
    const dir = `node_modules/${name}`;
    const { version, license } = JSON.parse(readFileSync(`${dir}/package.json`, 'utf8'));
    const file = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license'].find((f) => existsSync(`${dir}/${f}`));
    const text = file ? readFileSync(`${dir}/${file}`, 'utf8').trim() : `License: ${license}`;
    return `${name}@${version} (${license})\n\n${text}`;
  });
  const rule = `\n\n${'-'.repeat(72)}\n\n`;
  writeFileSync(
    'public/third-party-licenses.txt',
    `Tilt Kart bundles the following open-source packages in game.js.${rule}${sections.join(rule)}\n`,
  );
}
