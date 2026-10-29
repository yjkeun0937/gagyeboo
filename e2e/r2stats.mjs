import { chromium } from 'playwright-core';
const URL = 'http://localhost:4173/gagyeboo/';
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
let failed = 0;
const ok = (c, m) => { if (!c) { failed++; console.log('  FAIL:', m); } else console.log('  ok:', m); };
for (const [name, vp] of [['desktop', { width: 1366, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
  console.log(`\n[${name}]`);
  const ctx = await browser.newContext({ viewport: vp, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await page.goto(URL); await page.waitForSelector('.empty');
  await page.getByText('가상 데이터로 둘러보기').first().click();
  await page.waitForSelector('.ledger, .cards'); await page.waitForTimeout(400);
  if (await page.locator('.modal.is-wide').count()) { await page.keyboard.press('Escape'); await page.waitForTimeout(200); }
  await page.locator('.tab', { hasText: '통계' }).click();
  await page.getByRole('tab', { name: '연간' }).click(); await page.waitForTimeout(300);
  const layers = () => page.locator('.stat-card svg path[fill-opacity]').count();
  const chips = page.locator('.chart-filter .chip[aria-pressed]');
  const nChips = await chips.count();
  ok(nChips >= 5, `분류 칩 ${nChips}개`);
  ok((await layers()) === nChips, '기본: 모든 분류가 누적 영역으로 그려짐');
  ok((await page.locator('.chart-filter .chip[aria-pressed=true]').count()) === nChips, '기본: 전부 선택됨');
  const labels = await page.locator('.chart-filter .chip').allInnerTexts();
  ok(labels[0].trim() === '모두 지우기' && labels[1].trim() === '전체', '"모두 지우기"가 "전체" 왼쪽에 있음');
  await page.screenshot({ path: `e2e/out/r2s-${name}-all.png`, fullPage: true });
  await page.getByRole('button', { name: '모두 지우기' }).click(); await page.waitForTimeout(200);
  ok((await page.locator('.chart-filter .chip[aria-pressed=true]').count()) === 0, '모두 지우기 → 선택 없음');
  ok((await layers()) === 0 && (await page.getByText('표시할 분류를 선택하세요').count()) === 1, '선택 없으면 안내 문구');
  await chips.nth(0).click(); await chips.nth(2).click(); await page.waitForTimeout(200);
  ok((await layers()) === 2, '두 분류만 선택 → 2개 영역');
  await page.screenshot({ path: `e2e/out/r2s-${name}-two.png` });
  // 3단계: 선택안함 → 선택함1(위) → 선택함2(아래, 붉은색) → 선택안함
  ok((await chips.nth(0).getAttribute('data-mode')) === '1', '한 번 누르면 선택함1');
  await chips.nth(0).click(); await page.waitForTimeout(150);
  ok((await chips.nth(0).getAttribute('data-mode')) === '2', '두 번째 누르면 선택함2');
  const red = await chips.nth(0).evaluate((el) => getComputedStyle(el).borderTopColor);
  const blue = await chips.nth(2).evaluate((el) => getComputedStyle(el).borderTopColor);
  console.log('  border colors', red, blue);
  ok(red !== blue && /^rgb\((1[5-9]\d|2\d\d),/.test(red), '선택함2는 붉은 계열로 선택함1과 구분');
  ok((await layers()) === 2, '선택함2도 그래프에 표시');
  const tickTexts = await page.evaluate(() => [...document.querySelectorAll('.stat-card svg text.chart-tick')].map((t) => t.textContent));
  ok(!tickTexts.some((t) => /[-−]/.test(t)), 'y축 눈금은 음수 부호 없이 양수로 표시: ' + tickTexts.filter((t) => /만|^\d/.test(t)).join(','));
  const geo = await page.evaluate(() => {
    const paths = [...document.querySelectorAll('.stat-card svg path[fill-opacity]')];
    const zero = [...document.querySelectorAll('.stat-card svg line')].find((l) => l.getAttribute('stroke-width') === '1.5');
    const zy = parseFloat(zero.getAttribute('y1'));
    // path 좌표 중 0선 아래(y 큼)가 있는 path / 위가 있는 path
    const ys = paths.map((p) => [...p.getAttribute('d').matchAll(/,([\d.]+)/g)].map((m) => parseFloat(m[1])));
    return { zy, below: ys.map((a) => a.every((y) => y >= zy - 0.01)), above: ys.map((a) => a.every((y) => y <= zy + 0.01)) };
  });
  ok(geo.below.filter(Boolean).length === 1 && geo.above.filter(Boolean).length === 1, '선택함2 분류는 0선 아래, 선택함1은 0선 위에 쌓임');
  await page.screenshot({ path: `e2e/out/r2s-${name}-neg.png` });
  const downLabel = await page.locator('.chart-val.is-down').count();
  ok(downLabel > 0, `아래쪽 정점 라벨 ${downLabel}개 (양수 표기)`);
  await chips.nth(0).click(); await page.waitForTimeout(150);
  ok((await chips.nth(0).getAttribute('data-mode')) === '0' && (await layers()) === 1, '세 번째 누르면 선택안함');
  await chips.nth(1).click(); await chips.nth(1).click(); await page.waitForTimeout(150);
  ok((await page.locator('.chart-filter .chip[data-mode="2"]').count()) === 1, '일부를 선택함2로 둔 상태에서');
  await page.getByRole('button', { name: '전체', exact: true }).click(); await page.waitForTimeout(200);
  ok((await layers()) === nChips && (await page.locator('.chart-filter .chip[data-mode="1"]').count()) === nChips, '전체 → 모든 분류를 선택함1로');
  // 툴팁
  const col = page.locator('.stat-card svg rect[role=button]').nth(9);
  await page.locator('.stat-card svg').first().evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' })); await page.waitForTimeout(600);
  await col.click(); await page.waitForTimeout(200);
  const tip = await page.locator('.popover').innerText();
  console.log('  tooltip:', tip.replace(/\n/g, ' / '));
  ok(/10월/.test(tip) && /합계/.test(tip), '월 열 클릭 → 분류별 금액·합계 툴팁');
  await page.mouse.click(2, 2);
  // 표 셀 막대
  const bars = await page.locator('.matrix td.has-bar').count();
  ok(bars > 10, `지출표 셀 막대 ${bars}개`);
  const info = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.matrix tbody tr')];
    return rows.map((r) => [...r.querySelectorAll('td.has-bar')].map((td) => parseFloat(td.style.getPropertyValue('--h'))).sort((a, b) => b - a)[0]);
  });
  ok(info.every((m) => Math.abs(m - 100) < 0.01), '각 분류 행의 최대 셀은 막대 100%');
  await page.locator('.matrix-wrap').scrollIntoViewIfNeeded();
  await page.locator('.matrix-wrap').screenshot({ path: `e2e/out/r2s-${name}-matrix.png` });
  ok(errs.length === 0, '콘솔 오류 없음' + (errs.length ? errs.join('|') : ''));
  await ctx.close();
}
await browser.close();
console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
