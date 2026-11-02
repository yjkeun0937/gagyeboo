// 공유 시험 화면: 일반 앱과 분리되어 열리고, 로그인 전에는 단계 버튼이 잠겨 있다
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
let failed = 0;
const ok = (c, m) => { if (!c) { failed++; console.log('  FAIL:', m); } else console.log('  ok:', m); };
for (const [name, vp] of [['desktop', { width: 1280, height: 900 }], ['mobile', { width: 390, height: 780 }]]) {
  console.log(`\n[${name}]`);
  const ctx = await browser.newContext({ viewport: vp, locale: 'ko-KR' });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto('http://localhost:4173/gagyeboo/#share-lab');
  await page.waitForSelector('.lab');
  ok((await page.locator('.lab h1').innerText()).includes('계정 공유 시험'), '시험 화면이 열림');
  ok((await page.locator('.top-inner, .tabs').count()) === 0, '일반 앱 화면은 뜨지 않음');
  ok((await page.getByRole('button', { name: '폴더·파일 만들기' }).isDisabled()), '로그인 전에는 단계 버튼이 잠김');
  ok((await page.getByRole('button', { name: '소유자로 로그인' }).isEnabled()), '로그인 버튼은 사용 가능');
  await page.getByRole('button', { name: '손님으로 로그인' }).click();
  await page.waitForTimeout(300);
  ok((await page.locator('.lab-log').innerText()).includes('클라이언트 ID'), '클라이언트 ID가 없으면 안내 기록');
  const scrollable = await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight || getComputedStyle(document.body).overflowY !== 'hidden');
  ok(scrollable, '화면이 스크롤 가능');
  ok(errs.length === 0, '오류 없음 ' + errs.join('|'));
  await page.screenshot({ path: `e2e/out/sharelab-${name}.png`, fullPage: false });
  await ctx.close();
}
await browser.close();
console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
