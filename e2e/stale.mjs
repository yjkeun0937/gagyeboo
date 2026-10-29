// 다른 창에서 더 새로운 DB 버전이 열리면, 이 창에 새로고침 안내가 뜨는지 확인
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const a = await ctx.newPage();
await a.goto('http://localhost:4173/gagyeboo/');
await a.waitForSelector('.empty, .history');
const b = await ctx.newPage();
await b.goto('http://localhost:4173/gagyeboo/');
await b.evaluate(() => new Promise((res) => { const r = indexedDB.open('gagyeboo', 999 * 10); r.onupgradeneeded = () => {}; r.onsuccess = () => { r.result.close(); res(); }; r.onerror = () => res(); }));
await a.waitForTimeout(500);
const shown = await a.locator('.stale-banner').count();
console.log(shown === 1 ? 'ok: 다른 창이 DB를 올리면 새로고침 안내 표시' : 'FAIL: 안내 없음');
await browser.close();
process.exit(shown === 1 ? 0 : 1);
