import { chromium } from 'playwright-core';
/** R5 화면 캡처 (e2e/out, git 제외) */
const URL = 'http://localhost:4173/gagyeboo/';
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
async function shots(name, vp, mobile) {
  const ctx = await browser.newContext({ viewport: vp, locale: 'ko-KR', timezoneId: 'Asia/Seoul', ...(mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
  const page = await ctx.newPage();
  await page.goto(URL); await page.waitForSelector('.empty');
  await page.getByText('가상 데이터로 둘러보기').first().click(); await page.waitForSelector('.ledger, .cards'); await page.waitForTimeout(500);
  if (await page.locator('.modal.is-wide').count()) { await page.keyboard.press('Escape'); await page.waitForTimeout(200); }
  const snap = async (n) => { await page.waitForTimeout(250); await page.screenshot({ path: `e2e/out/r5-${name}-${n}.png`, fullPage: false }); };
  await page.locator('button[aria-label="검색·필터"]').click();
  await page.fill('input[aria-label="최소"]', '10000'); await page.fill('input[aria-label="사용처·명세 검색"]', '마트');
  await page.locator('input[aria-label="사용처·명세 검색"]').press('Enter');
  await snap('1-filter');
  await page.locator('.tag-row .btn', { hasText: '필터 지우기' }).click();
  await page.locator('button[aria-label="검색·필터"]').click();
  await page.locator('.view-toggle').click(); await snap('2-calendar');
  await page.locator('.cal-cell:has(.cal-total)').nth(3).click(); await snap('3-calendar-day');
  await page.locator('.tab', { hasText: '설정' }).click();
  if (mobile) await page.locator('.menu-item', { hasText: '분류별 예산' }).click(); else await page.locator('.side-item', { hasText: '분류별 예산' }).click();
  await page.waitForTimeout(200);
  for (let i = 0; i < 4; i++) { const inp = page.locator('.budget-row input').nth(i); await inp.fill(['50000', '80000', '300000', '20000'][i]); await inp.press('Enter'); }
  await snap('4-budget');
  await page.locator('.tab', { hasText: '내역' }).click(); await page.locator('.view-toggle').click();
  if (mobile) await page.locator('.breakdown-toggle').click();
  await snap('5-chips');
  await page.locator('.tab', { hasText: '통계' }).click(); await page.waitForTimeout(500);
  await page.locator('.stat-card', { hasText: '예산 대비 사용' }).scrollIntoViewIfNeeded(); await snap('6-stats');
  await ctx.close();
}
await shots('desktop', { width: 1280, height: 900 }, false);
await shots('tablet', { width: 820, height: 1000 }, false);
await shots('mobile', { width: 390, height: 844 }, true);
await browser.close();
