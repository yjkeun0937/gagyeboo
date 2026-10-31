import { chromium } from 'playwright-core';
const URL = 'http://localhost:4173/gagyeboo/';
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
let failed = 0;
const ok = (c, m) => { if (!c) { failed++; console.log('  FAIL:', m); } else console.log('  ok:', m); };

async function run(name, vp) {
  console.log(`\n[${name}]`);
  const ctx = await browser.newContext({ viewport: vp, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  const mobile = vp.width <= 640;
  await page.goto(URL);
  await page.waitForSelector('.empty');
  await page.getByText('가상 데이터로 둘러보기').first().click();
  await page.waitForSelector('.ledger, .cards');
  await page.waitForTimeout(500);
  const gotoSettings = async (label) => {
    await page.locator('.tab', { hasText: '설정' }).click();
    await page.waitForTimeout(150);
    if (mobile) { if (await page.locator('.menu-item').count()) await page.locator('.menu-item', { hasText: label }).click(); else { await page.locator('.back-btn, [aria-label="뒤로"]').first().click(); await page.locator('.menu-item', { hasText: label }).click(); } }
    else await page.locator('.side-item', { hasText: label }).click();
    await page.waitForTimeout(150);
  };
  const toHistory = async () => { await page.locator('.tab[data-tab="history"]').click(); await page.waitForTimeout(250); };
  const groupDates = async () => page.evaluate(() => [...document.querySelectorAll('[data-date]')].map((e) => e.getAttribute('data-date')).filter((v, i, a) => a.indexOf(v) === i));

  // 1) 정렬
  let d = await groupDates();
  console.log('  dates sample', d.slice(0, 4));
  ok(d.length > 3 && d[0] > d[d.length - 1], '기본 정렬 = 날짜 내림차순');
  // 데스크탑: 날짜 열 머리글 클릭, 휴대폰: 정렬 선택 상자
  const flipSort = async (toAsc) => {
    if (mobile) await page.locator('.breakdown-bar .sort-select').selectOption(toAsc ? 'date-asc' : 'date-desc');
    else await page.locator('.c-date .sort-head').click();
    await page.waitForTimeout(250);
  };
  await flipSort(true);
  d = await groupDates();
  ok(d[0] < d[d.length - 1], '정렬 버튼 → 오름차순');
  await page.reload(); await page.waitForSelector('.ledger, .cards'); await page.waitForTimeout(400);
  ok((await page.locator('.modal.is-wide').count()) === 1, '앱 시작 시 미처리 고정지출 창이 자동으로 열림');
  await page.locator('.modal.is-wide .btn', { hasText: '나중에' }).click(); await page.waitForTimeout(250);
  ok((await page.locator('.modal.is-wide').count()) === 0, '"나중에"로 닫힘');
  ok((await page.locator('.alert-chip.is-warn').count()) === 1, '닫아도 알림 칩은 남음');
  d = await groupDates();
  ok(d[0] < d[d.length - 1], '정렬 선택이 새로고침 후에도 유지');
  await flipSort(false);
  d = await groupDates();
  ok(d[0] > d[d.length - 1], '다시 눌러 내림차순 복귀');

  // 2) 월간 목표 + 배지
  ok((await page.locator('.goal-badge').count()) === 0, '목표 없을 땐 배지 없음');
  await gotoSettings('월간 목표');
  await page.fill('#goal-in', '100000');
  await page.locator('#goal-save').click();
  await page.waitForTimeout(250);
  await toHistory();
  ok((await page.locator('.goal-badge').count()) === 1, '목표(10만) 초과 예상 → 붉은 배지');
  await page.locator('.goal-badge').click(); await page.waitForTimeout(250);
  const pop = await page.locator('.popover[role=tooltip]').innerText().catch(() => '');
  console.log('  popover:', pop.replace(/\n/g, ' / '));
  ok(/목표/.test(pop) && /원/.test(pop), '배지 클릭 → 경고 툴팁 표시');
  await page.screenshot({ path: `e2e/out/r2f-${name}-badge.png` });
  await page.keyboard.press('Escape'); await page.mouse.click(5, 5);
  await gotoSettings('월간 목표');
  await page.fill('#goal-in', '50000000');
  await page.locator('#goal-save').click();
  await page.waitForTimeout(250);
  await toHistory();
  ok((await page.locator('.goal-badge').count()) === 0, '목표를 넉넉히 올리면 배지 사라짐');

  // 3) 미래 내역 표시
  const futureRows = async () => page.evaluate((t) => [...document.querySelectorAll('[data-date]')].filter((e) => e.getAttribute('data-date') > t).length, new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date()));
  const f0 = await futureRows();
  ok(f0 > 0, `모든 내역 표시: 오늘 이후 행 ${f0}개`);
  await gotoSettings('화면');
  await page.locator('.segmented button, .segmented label', { hasText: '건수만' }).first().click().catch(async () => { await page.getByText('건수', { exact: false }).first().click(); });
  await page.waitForTimeout(200);
  await toHistory();
  ok((await futureRows()) === 0, '건수만 표시: 미래 행 숨김');
  ok((await page.locator('.count-chip').count()) > 0, '건수 칩 표시');
  await page.locator('.count-chip').first().click(); await page.waitForTimeout(250);
  ok((await futureRows()) > 0, '건수 칩 클릭 → 임시로 펼침');
  await page.screenshot({ path: `e2e/out/r2f-${name}-future.png` });
  await gotoSettings('화면');
  await page.locator('.segmented button, .segmented label', { hasText: '표시하지 않음' }).first().click();
  await page.waitForTimeout(200);
  await toHistory();
  ok((await futureRows()) === 0 && (await page.locator('.count-chip').count()) === 0, '표시하지 않음: 행·칩 모두 없음');
  await gotoSettings('화면');
  await page.locator('.segmented button, .segmented label', { hasText: '모든 내역' }).first().click();

  // 4) 고정지출: 알림 칩 → 창 → 추가
  await toHistory();
  const chip = page.locator('.alert-chip.is-warn');
  ok((await chip.count()) === 1, '고정지출 미처리 알림 칩');
  await chip.click();
  await page.waitForSelector('.modal.is-wide');
  await page.screenshot({ path: `e2e/out/r2f-${name}-fixedwin.png` });
  const rows = await page.locator('.fw-row').count();
  const added = await page.locator('.fw-row.is-added').count();
  console.log(`  rows ${rows}, added ${added}`);
  ok(rows >= 3, '고정지출 항목 표시');
  const before = await page.locator('.stat-total .stat-value').innerText();
  await page.locator('.modal.is-wide .btn.primary').click();
  await page.waitForTimeout(500);
  ok((await page.locator('.modal.is-wide').count()) === 0, '추가 후 창 닫힘');
  const after = await page.locator('.stat-total .stat-value').innerText();
  console.log(`  total ${before} -> ${after}`);
  ok(await page.locator('.alert-chip.is-warn').count() === 0, '처리 후 알림 칩 사라짐');
  // 설정 > 고정지출 페이지
  await gotoSettings('고정지출');
  await page.waitForTimeout(200);
  await page.screenshot({ path: `e2e/out/r2f-${name}-fixedpage.png` });
  ok((await page.locator('.fixed-list li, .fx-row, .list-row').count()) > 0 || (await page.getByText('샘플').count()) > 0, '고정지출 설정 페이지에 등록 항목');

  ok(errs.length === 0, '콘솔 오류 없음' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await ctx.close();
}
await run('desktop', { width: 1366, height: 900 });
await run('mobile', { width: 390, height: 844 });
await browser.close();
console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
