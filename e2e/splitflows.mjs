// 데스크탑: 위쪽 조작 영역 고정 + 아래쪽 목록만 스크롤 / 날짜 직접 입력 자동 이동
import { chromium } from 'playwright-core';
const URL = 'http://localhost:4173/gagyeboo/';
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
let failed = 0;
const ok = (cond, msg) => { if (!cond) { failed++; console.log('  FAIL:', msg); } else console.log('  ok:', msg); };

async function setup(vp) {
  const ctx = await browser.newContext({ viewport: vp, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await page.goto(URL);
  await page.waitForSelector('.empty, .history');
  await page.getByText('가상 데이터로 둘러보기').click();
  await page.waitForSelector('.ledger, .cards');
  return { page, errs };
}
const winScroll = (page) => page.evaluate(() => document.documentElement.scrollHeight - innerHeight);

console.log('\n[desktop 1280x720]');
{
  const { page, errs } = await setup({ width: 1280, height: 720 });
  ok((await winScroll(page)) <= 1, '내역: 창 전체는 스크롤되지 않음');
  await page.locator('.monthnav .icon-btn[aria-label="전월"]').click();
  await page.waitForTimeout(150);
  const info = await page.evaluate(() => { const b = document.querySelector('.split-body'); return { sh: b.scrollHeight, ch: b.clientHeight, ov: getComputedStyle(b).overflowY }; });
  ok(info.sh > info.ch && info.ov === 'auto', `내역: 목록 영역만 스크롤됨 (${info.sh}>${info.ch})`);
  const barY = () => page.locator('.monthbar').first().evaluate((el) => Math.round(el.getBoundingClientRect().top));
  const y0 = await barY();
  await page.locator('.split-body').evaluate((el) => { el.scrollTop = 400; });
  ok((await page.locator('.split-body').evaluate((el) => el.scrollTop)) > 100, '목록을 아래로 스크롤');
  ok((await barY()) === y0, '스크롤해도 위쪽 영역 위치 그대로');
  await page.locator('.monthnav .icon-btn[aria-label="전월"]').click();
  await page.waitForTimeout(150);
  ok((await page.locator('.split-body').evaluate((el) => el.scrollTop)) === 0, '월을 바꾸면 목록이 맨 위로');
  await page.locator('.split-body').evaluate((el) => { el.scrollTop = 300; });
  await page.locator('button[aria-label="검색·필터"]').click().catch(() => {});
  await page.waitForTimeout(150);
  // 사용자 필터 칩
  const chip = page.locator('.sum-chip').first();
  if (await chip.count()) {
    await page.locator('.split-body').evaluate((el) => { el.scrollTop = 300; });
    await chip.click();
    await page.waitForTimeout(150);
    ok((await page.locator('.split-body').evaluate((el) => el.scrollTop)) === 0, '필터를 바꾸면 목록이 맨 위로');
  }

  // 통계
  await page.locator('.tab[data-tab="stats"]').click();
  await page.waitForSelector('.stats-view');
  ok((await winScroll(page)) <= 1, '통계(월간): 창 전체는 스크롤되지 않음');
  const st = await page.evaluate(() => { const b = document.querySelector('.stats-view .split-body'); return { sh: b.scrollHeight, ch: b.clientHeight }; });
  ok(st.sh > st.ch, `통계(월간): 카드 영역이 스크롤됨 (${st.sh}>${st.ch})`);
  ok(await page.locator('.split-top .subtabs').count() === 1 && await page.locator('.split-top .tiles').count() === 1, '통계(월간): 종류 탭·합계가 위쪽 고정 영역에 있음');
  await page.locator('.stats-view .split-body').evaluate((el) => { el.scrollTop = 500; });
  await page.locator('.monthnav .icon-btn[aria-label="전월"]').click();
  await page.waitForTimeout(150);
  ok((await page.locator('.stats-view .split-body').evaluate((el) => el.scrollTop)) === 0, '통계: 월을 바꾸면 맨 위로');
  for (const name of ['연간', '전체 기간', '기간 지정']) {
    await page.locator('.subtab', { hasText: name }).click();
    await page.waitForTimeout(150);
    ok((await winScroll(page)) <= 1 && await page.locator('.split-top .subtabs').count() === 1, `통계(${name}): 종류 탭은 위쪽 고정, 창 스크롤 없음`);
  }
  // 기간 지정: 선택 상자는 위쪽
  ok(await page.locator('.split-top #rg-cat').count() === 1, '기간 지정: 분류/사용자/지불수단 선택은 위쪽 고정 영역');

  // 재산상황
  await page.locator('.tab[data-tab="assets"]').click();
  await page.waitForSelector('.assets-view');
  ok((await winScroll(page)) <= 1 && await page.locator('.split-top .asset-toggle').count() === 1, '재산상황: 합계·상태 토글은 위쪽 고정');

  // 설정 → 목록
  await page.locator('.tab[data-tab="settings"]').click();
  await page.waitForSelector('.settings');
  ok((await winScroll(page)) <= 1, '설정(목록): 창 전체는 스크롤되지 않음');
  ok(await page.locator('.settings .split-top .subtabs').count() === 1, '설정(목록): 사용자/지불수단/분류 탭은 위쪽 고정');
  // 다른 설정 쪽은 쪽 전체가 스크롤
  await page.locator('.side-item', { hasText: '데이터 관리' }).click();
  await page.waitForTimeout(150);
  const pg = await page.evaluate(() => { const p = document.querySelector('.page'); return { sh: p.scrollHeight, ch: p.clientHeight, ov: getComputedStyle(p).overflowY }; });
  ok(pg.ov === 'auto' && pg.sh >= pg.ch, `설정(데이터 관리): 본문 영역 스크롤 가능 (${pg.sh}/${pg.ch})`);
  ok(errs.length === 0, '콘솔/페이지 오류 없음 ' + errs.join('|'));
}

console.log('\n[desktop 1280x500 (낮은 창)]');
{
  const { page } = await setup({ width: 1280, height: 500 });
  const h = await page.evaluate(() => ({ top: document.querySelector('.split-top').getBoundingClientRect().height, body: document.querySelector('.split-body').getBoundingClientRect().height }));
  ok(h.body > 120, `낮은 창에서도 목록 영역이 남음 (위 ${Math.round(h.top)} / 목록 ${Math.round(h.body)})`);
}

console.log('\n[mobile 390]');
{
  const { page } = await setup({ width: 390, height: 780 });
  ok((await winScroll(page)) > 10, '휴대폰: 쪽 전체가 스크롤됨(예전 방식 그대로)');
  const d = await page.evaluate(() => getComputedStyle(document.querySelector('.split-body')).display);
  ok(d === 'contents', '휴대폰: 분리 영역 없음');
}

console.log('\n[날짜 직접 입력]');
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  const page = await ctx.newPage();
  await page.goto(URL);
  await page.waitForSelector('.empty, .history');
  await page.locator('.tab[data-tab="assets"]').click();
  await page.waitForSelector('.assets-view');
  await page.locator('.assets-head .btn.primary').click();
  await page.waitForSelector('.sheet');
  await page.locator('.sheet .chip', { hasText: /^예금·계좌$/ }).click();
  await page.locator('.sheet .chip', { hasText: /^정기예금$/ }).click();
  const f = page.locator('#a-mat');
  const val = () => f.inputValue();
  await f.click();
  await page.keyboard.type('2026');
  ok((await val()) === '2026-', `연도 4자리 → 월로 넘어감 (${await val()})`);
  await page.keyboard.type('12');
  ok((await val()) === '2026-12-', `월 2자리 → 일로 넘어감 (${await val()})`);
  await page.keyboard.type('05');
  ok((await val()) === '2026-12-05', `일 입력 (${await val()})`);
  await f.fill('');
  await f.click();
  await page.keyboard.type('26');
  await page.keyboard.press('Tab');
  ok((await val()) === '2026-', `26 + Tab → 2026- (${await val()})`);
  ok(await page.evaluate(() => document.activeElement?.id) === 'a-mat', 'Tab 뒤에도 같은 입력창에서 월 입력을 이어감');
  await page.keyboard.type('3');
  ok((await val()) === '2026-03-', `월 3 → 03 으로 보충하고 일로 (${await val()})`);
  await page.keyboard.type('9');
  ok((await val()) === '2026-03-09', `일 9 → 09 (${await val()})`);
  await f.fill('');
  await f.click();
  await page.keyboard.type('20261231');
  ok((await val()) === '2026-12-31', `붙여 쓴 숫자 8자리 (${await val()})`);
  await page.keyboard.press('Backspace'); await page.keyboard.press('Backspace');
  ok((await val()) === '2026-12', `지울 때 하이픈이 다시 붙지 않음 (${await val()})`);
  // 달력 버튼
  ok(await page.locator('.date-field .date-pick').count() >= 1, '달력 버튼 있음');
  await f.fill('2026-13-40');
  await page.fill('#a-name', '가상은행'); await page.fill('#a-amount', '1000');
  await page.locator('.sheet-foot .btn.primary').click();
  ok((await page.locator('.sheet .error, .sheet [role="alert"], .form-error').first().innerText().catch(() => '')).includes('만기일'), '잘못된 날짜는 저장 막고 안내');
}

await browser.close();
console.log(failed ? `\n${failed}건 실패` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
