import { chromium } from 'playwright-core';
const URL = 'http://localhost:4173/gagyeboo/';
const sizes = { mobile: [390, 844], tablet: [820, 1180], desktop: [1366, 900] };
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const errors = [];
for (const [name, [w, h]] of Object.entries(sizes)) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`${name} console: ${m.text()}`));
  await page.goto(URL);
  await page.waitForSelector('.empty, .history');
  await page.getByText('가상 데이터로 둘러보기').first().click();
  await page.waitForSelector('.ledger, .cards');
  await page.waitForTimeout(400);
  // 고정지출 창이 자동으로 열렸는지
  const fw = await page.locator('.fw-body, .modal.is-wide').count();
  console.log(name, 'fixed window auto-open:', fw > 0);
  if (fw) { await page.screenshot({ path: `e2e/out/r2-${name}-1-fixedwin.png` }); await page.keyboard.press('Escape'); await page.waitForTimeout(200); }
  await page.screenshot({ path: `e2e/out/r2-${name}-2-history.png` });
  await page.locator('.tab', { hasText: '통계' }).click();
  await page.waitForSelector('.stats-view');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `e2e/out/r2-${name}-3-stats-month.png`, fullPage: true });
  await page.getByRole('tab', { name: '연간' }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `e2e/out/r2-${name}-4-stats-year.png`, fullPage: true });
  await page.getByRole('tab', { name: '기간 지정' }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `e2e/out/r2-${name}-5-stats-range.png`, fullPage: true });
  await ctx.close();
}
await browser.close();
console.log('errors:', errors.length ? errors : 'none');
