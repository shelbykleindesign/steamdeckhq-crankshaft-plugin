// Bundles src/ into public/game.js. The built file is committed so the
// public/ folder can be deployed to any static HTTPS host as-is.
//   npm run build        production bundle
//   npm run dev          rebuild on change + serve public/ on :8080
import * as esbuild from 'esbuild';

const serve = process.argv.includes('--serve');

const ctx = await esbuild.context({
  entryPoints: ['src/main.js'],
  bundle: true,
  format: 'esm',
  // iPadOS 15 is the oldest Safari with the WebGL2 three.js needs.
  target: ['safari15', 'chrome100', 'firefox100'],
  minify: !serve,
  sourcemap: serve ? 'inline' : false,
  outfile: 'public/game.js',
  logLevel: 'info',
});

if (serve) {
  await ctx.watch();
  const { port } = await ctx.serve({ servedir: 'public', port: 8080, host: '0.0.0.0' });
  console.log(`Serving public/ on http://localhost:${port}`);
  console.log('Motion sensors need HTTPS on iPad: tunnel this port or deploy (see README).');
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
