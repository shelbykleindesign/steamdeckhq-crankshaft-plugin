// Renders PNG app icons from the SVG. Needs Playwright:
//   npx playwright@1 install chromium   (once)   then   node tools/render-icons.mjs
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const svg = readFileSync(new URL('../public/icons/icon.svg', import.meta.url), 'utf8');
// iOS and Android apply their own corner mask, so the PNGs are full-bleed squares.
const square = svg.replace(/<rect width="512" height="512" rx="112"/, '<rect width="512" height="512"');
const browser = await chromium.launch();
const page = await browser.newPage();
for (const size of [180, 192, 512]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${square}`,
  );
  await page.screenshot({ path: new URL(`../public/icons/icon-${size}.png`, import.meta.url).pathname });
}
await browser.close();
