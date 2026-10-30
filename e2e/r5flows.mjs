import { chromium } from 'playwright-core';

/** R5: 검색·필터 고도화, 열 정렬, 캘린더, 분류별 예산, 휴대폰 키보드 스크롤 */
const URL = 'http://localhost:4173/gagyeboo/';
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
let failed = 0;
const ok = (c, m) => { if (!c) { failed++; console.log('  FAIL:', m); } else console.log('  ok:', m); };
const num = (s) => Number(String(s).replace(/[^\d-]/g, ''));

async function open(vp, mobile) {
  const ctx = await browser.newContext({
    viewport: vp, locale: 'ko-KR', timezoneId: 'Asia/Seoul',
    ...(mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}),
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await page.goto(URL);
  await page.waitForSelector('.empty');
  await page.getByText('가상 데이터로 둘러보기').first().click();
  await page.waitForSelector('.ledger, .cards');
  await page.waitForTimeout(500);
  if (await page.locator('.modal.is-wide').count()) { await page.keyboard.press('Escape'); await page.waitForTimeout(200); }
  return { ctx, page, errs };
}

const amounts = (page, mobile) =>
  page.evaluate((m) => [...document.querySelectorAll(m ? '.cards .card .amt' : '.ledger .row:not(.head):not(.sub) .c-amt')].map((e) => Number(e.textContent.replace(/[^\d-]/g, ''))), mobile);

/* ───────────────────────── 데스크탑 ───────────────────────── */
{
  console.log('\n[desktop 1280]');
  const { ctx, page, errs } = await open({ width: 1280, height: 860 }, false);
  const baseRows = (await amounts(page, false)).length;

  // 단축키 제거 확인
  const m0 = await page.locator('.month-title').innerText();
  await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(150);
  ok((await page.locator('.month-title').innerText()) === m0, '← 키로 달이 바뀌지 않음 (단축키 없음)');
  await page.keyboard.press('n'); await page.waitForTimeout(250);
  ok((await page.locator('.sheet').count()) === 0, 'N 키로 입력창이 열리지 않음');

  // 금액 범위
  await page.locator('button[aria-label="검색·필터"]').click();
  await page.fill('input[aria-label="최소"]', '100000');
  await page.waitForTimeout(250);
  let a = await amounts(page, false);
  ok(a.length > 0 && a.length < baseRows && a.every((x) => x >= 100000), `금액 최소 100,000 → ${a.length}건, 모두 이상`);
  ok((await page.locator('.tag-row .tag', { hasText: '이상' }).count()) === 1, '금액 조건 태그 표시');
  ok(/결과 \d+건 · 합계/.test(await page.locator('.result-sum').innerText()), '결과 요약 (건수·합계)');
  await page.fill('input[aria-label="최대"]', '200000');
  await page.waitForTimeout(250);
  a = await amounts(page, false);
  ok(a.every((x) => x >= 100000 && x <= 200000), '금액 범위 최소~최대');
  ok((await page.locator('.tag-row .tag', { hasText: '~' }).count()) === 1, '범위 태그');
  await page.locator('.tag-row .btn', { hasText: '필터 지우기' }).click();
  await page.waitForTimeout(250);
  ok((await amounts(page, false)).length === baseRows, '필터 지우기 → 원래 건수');

  // 검색어 강조와 최근 검색어
  await page.fill('input[aria-label="사용처·명세 검색"]', '마트');
  await page.waitForTimeout(250);
  const marks = await page.locator('.ledger mark').allInnerTexts();
  ok(marks.length > 0 && marks.every((t) => t === '마트'), `검색어 강조 ${marks.length}곳`);
  await page.locator('input[aria-label="사용처·명세 검색"]').press('Enter');
  await page.waitForTimeout(150);
  await page.fill('input[aria-label="사용처·명세 검색"]', '');
  await page.waitForTimeout(200);
  ok((await page.locator('.recent-chip', { hasText: '마트' }).count()) === 1, '검색 후 최근 검색어에 "마트"');
  await page.locator('.recent-pick', { hasText: '마트' }).click();
  await page.waitForTimeout(200);
  ok((await page.locator('input[aria-label="사용처·명세 검색"]').inputValue()) === '마트', '최근 검색어를 누르면 입력됨');
  await page.locator('.tag-row .btn', { hasText: '필터 지우기' }).click();
  await page.reload(); await page.waitForSelector('.ledger');
  if (await page.locator('.modal.is-wide').count()) { await page.keyboard.press('Escape'); await page.waitForTimeout(200); }
  await page.locator('button[aria-label="검색·필터"]').click();
  ok((await page.locator('.recent-chip', { hasText: '마트' }).count()) === 1, '새로고침 후에도 최근 검색어 유지');
  await page.locator('.recent-x[aria-label*="마트"]').click();
  ok((await page.locator('.recent-chip', { hasText: '마트' }).count()) === 0, '최근 검색어 하나 지우기');

  // 전체 기간 + 기간 범위
  await page.locator('.segmented button', { hasText: '전체 기간' }).click();
  await page.waitForTimeout(200);
  const ym = (await page.evaluate(() => document.querySelector('.ledger .day')?.dataset.date ?? '')).slice(0, 7);
  const allRows = (await amounts(page, false)).length;
  await page.fill('input[aria-label="시작일"]', `${ym}-15`);
  await page.waitForTimeout(250);
  const dates = await page.evaluate(() => [...document.querySelectorAll('.ledger .day')].map((e) => e.dataset.date));
  ok(dates.length > 0 && dates.every((d) => d >= `${ym}-15`) && (await amounts(page, false)).length < allRows, `기간 시작일 이후만 (${dates.length}일치)`);
  ok((await page.locator('.tag-row .tag', { hasText: '이후' }).count()) === 1, '기간 태그');
  await page.locator('.segmented button', { hasText: '이 달' }).click();
  await page.waitForTimeout(250);
  ok((await page.locator('.tag-row .tag', { hasText: '이후' }).count()) === 0, '"이 달"로 바꾸면 기간 조건이 해제됨');
  await page.locator('button[aria-label="검색·필터"]').click();

  // 열 정렬
  const headBtn = (t) => page.locator('.ledger .row.head .sort-head', { hasText: t });
  await headBtn('금액').click(); await page.waitForTimeout(250);
  a = await amounts(page, false);
  ok(a.length === baseRows && a.every((x, i) => i === 0 || a[i - 1] >= x), '금액 열 → 큰 순');
  ok((await page.locator('.ledger .row.sub').count()) === 0, '열 정렬 중에는 일계 행 없음');
  await headBtn('금액').click(); await page.waitForTimeout(250);
  a = await amounts(page, false);
  ok(a.every((x, i) => i === 0 || a[i - 1] <= x), '금액 열 다시 → 작은 순');
  await headBtn('사용처').click(); await page.waitForTimeout(250);
  const stores = await page.evaluate(() => [...document.querySelectorAll('.ledger .row:not(.head):not(.sub) .store-text')].map((e) => e.textContent.trim()).filter(Boolean));
  const sorted = [...stores].sort((x, y) => x.localeCompare(y, 'ko'));
  ok(stores.join() === sorted.join(), '사용처 열 → 가나다순');
  ok((await page.locator('.ledger .row.head [aria-sort="ascending"]').count()) === 1, '정렬 열 aria-sort');
  await headBtn('날짜').click(); await page.waitForTimeout(250);
  ok((await page.locator('.ledger .row.head .c-date[aria-sort="descending"]').count()) === 1, '날짜 열 → 날짜별 묶음으로 복귀');

  // 캘린더
  const dim = await page.evaluate(() => { const [y, m] = document.querySelector('.ledger .day').dataset.date.split('-').map(Number); return new Date(y, m, 0).getDate(); });
  const listTotal = num(await page.locator('.stat-total .stat-value').innerText());
  await page.locator('.view-toggle').click(); await page.waitForTimeout(300);
  ok((await page.locator('.cal-cell').count()) === dim, `캘린더 날짜 칸 ${dim}개`);
  ok((await page.locator('.cal-cell.is-today').count()) === 1, '오늘 표시');
  const calTotal = num(await page.locator('.cal-foot b').innerText());
  ok(calTotal === listTotal, `달력 월 합계(${calTotal}) = 목록 월 합계(${listTotal})`);
  const cellSum = await page.evaluate(() => [...document.querySelectorAll('.cal-cell .cal-total')].reduce((s, e) => s + Number(e.textContent.replace(/[^\d-]/g, '')), 0));
  ok(cellSum === listTotal, '날짜 칸 합계를 더하면 월 합계');
  const withTotal = page.locator('.cal-cell:has(.cal-total)').first();
  const cellT = num(await withTotal.locator('.cal-total').innerText());
  await withTotal.click(); await page.waitForTimeout(200);
  ok(num(await page.locator('.cal-panel-head .num').innerText()) === cellT, '날짜를 누르면 그날 합계와 내역 표시');
  ok((await page.locator('.cal-panel .card').count()) > 0, '그날 내역 카드');
  await page.locator('.cal-panel .btn', { hasText: '이 날 지출 입력' }).click(); await page.waitForSelector('.sheet');
  ok((await page.locator('#f-date').inputValue()).length > 0, '이 날 지출 입력 → 입력창 열림');
  await page.keyboard.press('Escape'); await page.waitForTimeout(250);
  if (await page.locator('.sheet').count()) { await page.locator('.sheet-head .icon-btn').first().click(); await page.waitForTimeout(250); }
  // 필터가 달력에도 적용
  await page.locator('.bk-group:has(.bk-title:text("분류")) .sum-chip').first().click(); await page.waitForTimeout(250);
  ok(/필터 적용/.test(await page.locator('.cal-foot').innerText()), '캘린더에도 필터 적용');
  ok(num(await page.locator('.cal-foot b').innerText()) < listTotal, '필터를 걸면 달력 합계가 줄어듦');
  await page.locator('.tag-row .btn', { hasText: '필터 지우기' }).click(); await page.waitForTimeout(200);

  // 기본 보기 설정
  await page.locator('.tab', { hasText: '설정' }).click();
  await page.locator('.side-item', { hasText: '화면' }).click();
  await page.locator('.segmented[aria-label="기본 보기"] button', { hasText: '캘린더' }).click(); await page.waitForTimeout(200);
  await page.reload(); await page.waitForSelector('.app');
  await page.waitForTimeout(500);
  if (await page.locator('.modal.is-wide').count()) { await page.keyboard.press('Escape'); await page.waitForTimeout(200); }
  await page.locator('.tab', { hasText: '내역' }).click(); await page.waitForTimeout(300);
  ok((await page.locator('.cal-grid').count()) === 1, '기본 보기를 캘린더로 → 새로고침 후 캘린더로 시작');
  await page.locator('.view-toggle').click(); await page.waitForTimeout(200);
  ok((await page.locator('.ledger').count()) === 1, '버튼으로 목록 전환');

  // 분류별 예산
  await page.locator('.tab', { hasText: '설정' }).click();
  await page.locator('.side-item', { hasText: '분류별 예산' }).click(); await page.waitForTimeout(200);
  const rows = await page.locator('.budget-row').count();
  for (let i = 0; i < rows; i++) {
    const inp = page.locator('.budget-row input').nth(i);
    await inp.fill('1000'); await inp.press('Enter'); await page.waitForTimeout(80);
  }
  ok(rows > 0, `분류 ${rows}개 예산 입력`);
  ok((await page.locator('.budget-use.lv-over').count()) > 0, '한도를 넘은 분류는 설정 화면에도 초과 표시');
  await page.reload(); await page.waitForSelector('.app'); await page.waitForTimeout(400);
  if (await page.locator('.modal.is-wide').count()) { await page.keyboard.press('Escape'); await page.waitForTimeout(200); }
  await page.locator('.tab', { hasText: '설정' }).click();
  await page.locator('.side-item', { hasText: '분류별 예산' }).click(); await page.waitForTimeout(200);
  ok((await page.locator('.budget-row input').first().inputValue()) === '1,000', '예산이 새로고침 후에도 유지');
  await page.locator('.tab', { hasText: '내역' }).click(); await page.waitForTimeout(300);
  ok((await page.locator('.sum-chip .bud-flag').count()) > 0, '분류 칩에 빨간 느낌표(한도 초과)');
  ok((await page.locator('.sum-chip.has-budget .bud-meter').count()) > 0, '분류 칩에 진행률 바');
  await page.locator('.tab', { hasText: '통계' }).click(); await page.waitForTimeout(500);
  const card = page.locator('.stat-card', { hasText: '예산 대비 사용' });
  ok((await card.count()) === 1 && /한도 초과/.test(await card.innerText()), '통계에 "예산 대비 사용" 카드와 초과 문구');
  // 예산 해제
  await page.locator('.tab', { hasText: '설정' }).click();
  await page.locator('.side-item', { hasText: '분류별 예산' }).click(); await page.waitForTimeout(200);
  for (let i = 0; i < rows; i++) {
    const inp = page.locator('.budget-row input').nth(i);
    await inp.fill(''); await inp.press('Enter'); await page.waitForTimeout(80);
  }
  await page.locator('.tab', { hasText: '통계' }).click(); await page.waitForTimeout(400);
  ok((await page.locator('.stat-card', { hasText: '예산 대비 사용' }).count()) === 0, '한도를 모두 비우면 예산 카드가 사라짐');

  ok(errs.length === 0, '콘솔/페이지 오류 없음 ' + errs.join(' | ').slice(0, 200));
  await ctx.close();
}

/* ───────────────────────── 휴대폰 ───────────────────────── */
{
  console.log('\n[mobile 390]');
  const { ctx, page, errs } = await open({ width: 390, height: 844 }, true);
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

  // 정렬 선택 상자
  const sel = page.locator('.breakdown-bar .sort-select');
  ok((await sel.locator('option').count()) === 6, '정렬 선택 상자(6가지)');
  await sel.selectOption('amt-desc'); await page.waitForTimeout(300);
  let a = await amounts(page, true);
  ok(a.length > 3 && a.every((x, i) => i === 0 || a[i - 1] >= x), '금액 큰 순 정렬');
  ok((await page.locator('.cards .card-date').count()) === a.length, '열 정렬 중에는 카드마다 날짜 표시');
  await sel.selectOption('date-desc'); await page.waitForTimeout(250);
  ok((await page.locator('.cards .day-head').count()) > 0, '최신순으로 돌아오면 날짜별 묶음');

  // 필터 입력이 폭에 맞는지
  await page.locator('button[aria-label="검색·필터"]').click(); await page.waitForTimeout(200);
  ok((await overflow()) <= 0, `검색·필터 영역이 가로로 넘치지 않음 (${await overflow()})`);
  await page.locator('button[aria-label="검색·필터"]').click();

  // 캘린더
  await page.locator('.view-toggle').click(); await page.waitForTimeout(300);
  ok((await page.locator('.cal-cell').count()) >= 28, '캘린더 표시');
  ok((await overflow()) <= 0, `캘린더가 가로로 넘치지 않음 (${await overflow()})`);
  const cw = await page.evaluate(() => { const r = document.querySelector('.cal-cell').getBoundingClientRect(); return r.width; });
  ok(cw >= 40, `날짜 칸 폭 ${Math.round(cw)}px`);
  const wide = await page.evaluate(() => [...document.querySelectorAll('.cal-cell')].filter((c) => c.scrollWidth > c.clientWidth + 1).length);
  ok(wide === 0, '금액이 칸 밖으로 잘리지 않음');
  await page.screenshot({ path: 'e2e/out/r5-mobile-cal.png' });
  await page.locator('.view-toggle').click(); await page.waitForTimeout(200);

  // 키보드가 올라와도 입력란이 가려지지 않게 맨 위로 스크롤
  await page.locator('.fab').click(); await page.waitForSelector('.sheet');
  await page.waitForTimeout(400);
  const KB = 340;
  await page.locator('#f-memo').scrollIntoViewIfNeeded();
  await page.locator('#f-memo').focus();
  await page.setViewportSize({ width: 390, height: 844 - KB }); // 키보드가 올라온 것과 같은 효과
  await page.waitForTimeout(900);
  const r = await page.evaluate(() => {
    const e = document.querySelector('#f-memo').getBoundingClientRect();
    const sb = document.querySelector('.sheet-body').getBoundingClientRect();
    return { top: e.top, bottom: e.bottom, vh: window.innerHeight, sheetTop: sb.top, sheetBottom: document.querySelector('.sheet').getBoundingClientRect().bottom };
  });
  console.log('  memo rect', JSON.stringify(r));
  ok(r.bottom <= r.vh, '입력란이 키보드(줄어든 화면) 아래로 내려가지 않음');
  ok(r.top - r.sheetTop < (r.vh - r.sheetTop) * 0.45, `입력란이 보이는 영역의 위쪽에 있음 (시트 위에서 ${Math.round(r.top - r.sheetTop)}px)`);
  ok(r.sheetBottom <= r.vh + 1, '입력창이 키보드 위에 붙어 있음');
  await page.screenshot({ path: 'e2e/out/r5-mobile-kb.png' });
  // 다른 입력란(금액)으로 옮겨도 마찬가지
  await page.locator('#f-amount').focus(); await page.waitForTimeout(800);
  const r2 = await page.evaluate(() => { const e = document.querySelector('#f-amount').getBoundingClientRect(); return { top: e.top, bottom: e.bottom, vh: window.innerHeight }; });
  ok(r2.bottom <= r2.vh && r2.top >= 0, '금액 입력란도 화면 안에 보임');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#f-amount').blur(); await page.waitForTimeout(400);
  ok(!(await page.evaluate(() => document.documentElement.classList.contains('kb-open'))), '입력을 마치면 여백 클래스 해제');

  ok(errs.length === 0, '콘솔/페이지 오류 없음 ' + errs.join(' | ').slice(0, 200));
  await ctx.close();
}

await browser.close();
console.log(failed ? `\n${failed}건 실패` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
