// 앱 아이콘 PNG를 favicon.svg와 같은 그림으로 만든다. (CHROME=크롬경로 node scripts/make-icons.mjs)
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const glyph = (scale) => `
  <g transform="translate(32 32) scale(${scale}) translate(-32 -32)" stroke="#fff" stroke-width="3" stroke-linecap="round" fill="none" opacity=".95">
    <path d="M16 22h32M16 34h32M16 46h20"/>
    <path d="M30 14v40" opacity=".55"/>
  </g>`;
// 일반 아이콘: 둥근 모서리 / 마스크용: 가장자리까지 채우고 그림은 가운데 안전 영역(약 66%)에만 둔다
const svgs = {
  any: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#2338A0"/>${glyph(1)}</svg>`,
  maskable: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#2338A0"/>${glyph(0.7)}</svg>`,
};
const jobs = [
  ['icon-192.png', 'any', 192],
  ['icon-512.png', 'any', 512],
  ['icon-maskable-512.png', 'maskable', 512],
  ['apple-touch-icon.png', 'maskable', 180],
];
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
fs.mkdirSync('public/icons', { recursive: true });
for (const [file, kind, size] of jobs) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svgs[kind]}`);
  await page.screenshot({ path: `public/icons/${file}`, omitBackground: true });
  await page.close();
  console.log('wrote', file);
}
await browser.close();
