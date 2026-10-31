import { chromium } from 'playwright-core';
const URL = 'http://localhost:4173/gagyeboo/';
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const ymd = (n) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(Date.now() + n * 86400000));
for (const [name, vp] of [['desktop', { width: 1280, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
  const ctx = await browser.newContext({ viewport: vp, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  const page = await ctx.newPage();
  await page.goto(URL); await page.waitForSelector('.empty, .history');
  await page.locator('.tab[data-tab="assets"]').click();
  const add = async (cat, n, kind, amt, fn) => {
    await page.locator('.assets-head .btn.primary').click(); await page.waitForSelector('.sheet');
    await page.locator('.sheet .chip', { hasText: new RegExp(`^${cat}$`) }).click();
    await page.fill('#a-name', n); if (kind) await page.locator('.sheet .chip', { hasText: new RegExp(`^${kind}$`) }).click();
    if (amt) await page.fill('#a-amount', String(amt)); if (fn) await fn();
    await page.locator('.sheet-foot .btn.primary').click(); await page.waitForSelector('.sheet', { state: 'detached' });
  };
  await add('예금·계좌', '가상은행', '정기예금', 30000000, async () => { await page.fill('#a-term', '1년'); await page.fill('#a-rate', '3.2'); await page.fill('#a-mat', ymd(12)); });
  await add('예금·계좌', '가상은행', '입출금', 1200000);
  await add('예금·계좌', '샘플조합', '정기예금', 12000000, async () => { await page.fill('#a-mat', ymd(-5)); });
  await add('부동산', '샘플아파트', '아파트', 600000000);
  await add('보험', '예시생명', '종신', null, async () => { await page.locator('.sheet .chip', { hasText: '납입완료' }).click(); await page.fill('#a-cov', '65세 혹은 사망시'); });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `e2e/out/assets-${name}-list.png`, fullPage: true });
  await (vp.width < 600 ? page.locator('.asset-card .asset-name', { hasText: '가상은행' }).first() : page.locator('.asset-row th', { hasText: '가상은행' }).first()).click();
  await page.waitForSelector('.sheet');
  await page.fill('#a-amount', '31000000'); await page.fill('#a-note', '이자 입금');
  await page.locator('.sheet-foot .btn.primary').click(); await page.waitForSelector('.sheet', { state: 'detached' });
  await (vp.width < 600 ? page.locator('.asset-card .asset-name', { hasText: '가상은행' }).first() : page.locator('.asset-row th', { hasText: '가상은행' }).first()).click();
  await page.waitForSelector('.sheet'); await page.waitForTimeout(300);
  await page.screenshot({ path: `e2e/out/assets-${name}-sheet.png` });
  await page.locator('.asset-history summary').click(); await page.locator('.asset-history').scrollIntoViewIfNeeded(); await page.waitForTimeout(200);
  await page.screenshot({ path: `e2e/out/assets-${name}-sheet-history.png` });
  await ctx.close();
}
await browser.close();
