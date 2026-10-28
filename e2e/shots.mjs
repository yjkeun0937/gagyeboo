import { chromium } from 'playwright-core';
const URL = 'http://localhost:4173/gagyeboo/';
const sizes = { mobile: [390, 844], tablet: [820, 1180], desktop: [1366, 900] };
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const errors = [];
for (const [name, [w, h]] of Object.entries(sizes)) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: 'ko-KR', timezoneId: 'Asia/Seoul', deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`${name} console: ${m.text()}`));
  await page.goto(URL);
  await page.waitForSelector('.empty, .history');
  await page.screenshot({ path: `e2e/out/${name}-0-empty.png` });
  await page.getByText('가상 데이터로 둘러보기').first().click();
  await page.waitForSelector('.ledger, .cards');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `e2e/out/${name}-1-history.png` });
  await page.screenshot({ path: `e2e/out/${name}-1b-history-full.png`, fullPage: true });
  // 입력 시트
  if (name === 'mobile') await page.locator('.fab').click(); else await page.locator('.add-btn').click();
  await page.waitForSelector('.sheet');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `e2e/out/${name}-2-entry.png` });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  // 설정
  await page.locator('.tab', { hasText: '설정' }).click();
  await page.waitForTimeout(200);
  if (name === 'mobile') { await page.locator('.menu-item', { hasText: '목록 관리' }).click(); }
  await page.waitForTimeout(200);
  await page.screenshot({ path: `e2e/out/${name}-3-settings.png` });
  await ctx.close();
}
await browser.close();
console.log('errors:', errors.length ? errors : 'none');
