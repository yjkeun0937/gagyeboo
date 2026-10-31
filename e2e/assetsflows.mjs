// 재산상황 탭: 탭 구성(휴대폰 슬라이드), 입력·합계·상태 전환·이력(접힘)·완전 삭제·만기 표시
import { chromium } from 'playwright-core';
const URL = 'http://localhost:4173/gagyeboo/';
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
let failed = 0;
const ok = (cond, msg) => { if (!cond) { failed++; console.log('  FAIL:', msg); } else console.log('  ok:', msg); };
const ymd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
const addDays = (n) => ymd(new Date(Date.now() + n * 86400000));

async function run(name, vp) {
  console.log(`\n[${name}]`);
  const ctx = await browser.newContext({ viewport: vp, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  const mobile = vp.width <= 640;
  await page.goto(URL);
  await page.waitForSelector('.empty, .history');

  // 탭 구성
  const tabs = await page.locator('.tabs .tab').allInnerTexts();
  ok(tabs.map((t) => t.trim()).join('|') === '사용 내역|사용 내역 통계|재산상황|설정', `탭 순서 (${tabs.join('|')})`);
  if (mobile) {
    const m = await page.evaluate(() => { const t = document.querySelector('.tabs'); return { sw: t.scrollWidth, cw: t.clientWidth, over: document.documentElement.scrollWidth > innerWidth }; });
    ok(m.sw > m.cw && !m.over, `휴대폰: 탭 줄이 좌우로 밀 수 있고 페이지는 넘치지 않음 (${m.sw}>${m.cw})`);
    await page.locator('.tabs').evaluate((el) => { el.scrollLeft = 0; });
    await page.locator('.tab[data-tab="settings"]').scrollIntoViewIfNeeded();
    ok((await page.locator('.tabs').evaluate((el) => el.scrollLeft)) > 0, '밀면 뒤쪽 탭이 나타남');
  }
  await page.locator('.tab[data-tab="assets"]').click();
  await page.waitForSelector('.assets-view');
  if (mobile) {
    const vis = await page.locator('.tab[data-tab="assets"]').evaluate((el) => { const r = el.getBoundingClientRect(), p = el.parentElement.getBoundingClientRect(); return r.left >= p.left - 1 && r.right <= p.right + 1; });
    ok(vis, '고른 탭이 보이는 위치에 있음');
  }
  ok((await page.locator('.empty-title').innerText()).includes('등록한 재산 항목이 없습니다'), '빈 상태 안내');
  ok((await page.locator('.assets-view .tile').nth(2).innerText()).includes('-'), '최종 업데이트: 항목 없으면 -');

  const add = async ({ cat, name, kind, amount, extra }) => {
    await page.locator('.assets-head .btn.primary').click();
    await page.waitForSelector('.sheet');
    await page.locator('.sheet .chip', { hasText: new RegExp(`^${cat}$`) }).click();
    await page.fill('#a-name', name);
    if (kind) await page.locator('.sheet .chip', { hasText: new RegExp(`^${kind}$`) }).click();
    if (amount != null) await page.fill('#a-amount', String(amount));
    if (extra) await extra();
    await page.locator('.sheet-foot .btn.primary').click();
    await page.waitForSelector('.sheet', { state: 'detached' });
  };
  const tile = async (i) => (await page.locator('.assets-view .tile').nth(i).locator('.tile-value').innerText()).replace(/[^\d]/g, '');

  // 입력: 예금(현금 기본 포함), 부동산(제외), 보험(금액 미정)
  await add({ cat: '예금·계좌', name: '가상은행', kind: '정기예금', amount: 30000000, extra: async () => {
    await page.fill('#a-term', '1년'); await page.fill('#a-rate', '3.2'); await page.fill('#a-mat', addDays(-3));
  } });
  await add({ cat: '부동산', name: '샘플아파트', kind: '아파트', amount: 600000000 });
  await add({ cat: '보험', name: '예시생명', kind: '종신', amount: null });
  ok((await tile(0)) === '630000000', '보유 총계 630,000,000');
  ok((await tile(1)) === '30000000', '현금 총계 30,000,000 (부동산·보험은 제외)');
  ok((await page.locator('.assets-view .hint').first().innerText()).includes('1건'), '금액 미정 1건 안내');
  const upd = await page.locator('.assets-view .tile').nth(2).locator('.tile-value').innerText();
  ok(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(upd.trim()), `최종 업데이트 시각 표시 (${upd.trim()})`);
  const cats = await page.locator('.asset-cat h4').allInnerTexts();
  ok(cats.map((c) => c.split(/\s/)[0]).join(',') === '보험,부동산,예금·계좌', `분류별 묶음 순서 (${cats.map((c) => c.split(/\s/)[0]).join(',')})`);

  // 만기 경과 표시와 단축 버튼
  ok((await page.locator('.asset-over').count()) === 1, '만기 경과 표시');
  ok((await page.locator('.asset-quick .btn', { hasText: '종료로 이동' }).count()) === 1 && (await page.locator('.asset-quick .btn', { hasText: '복사해서 새로 등록' }).count()) === 1, '경과 항목 단축 버튼');

  // 상태 토글
  const toggles = await page.locator('.asset-toggle button').allInnerTexts();
  ok(toggles.map((t) => t.replace(/\s+/g, ' ').trim()).join('|') === '보유 3|종료 0|휴지통 0', `상태 토글 (${toggles.join('|').replace(/\s+/g, ' ')})`);
  await page.locator('.asset-toggle button', { hasText: '보유' }).click();
  ok((await page.locator('.asset-group').count()) === 1, '마지막 하나는 끌 수 없음');

  // 항목 열기: 이력은 접힌 상태, 금액만 수정
  const open = async (n) => { await (mobile ? page.locator('.asset-card', { hasText: n }).locator('.asset-name') : page.locator('.asset-row', { hasText: n }).locator('th')).first().click(); await page.waitForSelector('.sheet'); };
  await open('가상은행');
  ok((await page.locator('.asset-history').evaluate((d) => d.open)) === false, '변경 이력은 기본으로 접혀 있음');
  ok((await page.locator('.asset-history summary').innerText()).includes('1건'), '이력 1건');
  ok(await page.evaluate(() => document.activeElement?.id) === 'a-amount', '수정 창은 금액에 포커스');
  await page.fill('#a-amount', '33000000');
  await page.fill('#a-note', '이자 입금');
  await page.locator('.sheet-foot .btn.primary').click();
  await page.waitForSelector('.sheet', { state: 'detached' });
  ok((await tile(0)) === '633000000' && (await tile(1)) === '33000000', '수정 후 합계 반영');
  await open('가상은행');
  await page.locator('.asset-history summary').click();
  const logText = await page.locator('.log-list').innerText();
  ok(/수정/.test(logText) && logText.includes('30,000,000원') && logText.includes('33,000,000원') && logText.includes('+3,000,000원') && logText.includes('이자 입금'), '이력: 변경 전후·증감·메모');
  ok((await page.locator('.log-item').count()) === 2, '이력 2건 (등록, 수정)');

  // 종료로 옮기기 (사유 해지)
  await page.locator('.asset-state-box .btn', { hasText: '종료로 옮기기' }).click();
  await page.locator('.asset-end-panel .chip', { hasText: '해지' }).click();
  await page.locator('.asset-end-panel .btn.primary').click();
  await page.waitForSelector('.sheet', { state: 'detached' });
  ok((await tile(0)) === '600000000' && (await tile(1)) === '0', '종료하면 합계에서 빠짐');
  const tg = await page.locator('.asset-toggle button').allInnerTexts();
  ok(tg.map((t) => t.replace(/\s+/g, ' ').trim()).join('|') === '보유 2|종료 1|휴지통 0', '토글 건수 갱신');
  await page.locator('.asset-toggle button', { hasText: '종료' }).click();
  const order = await page.locator('.asset-group').evaluateAll((gs) => gs.map((g) => g.dataset.state));
  ok(order.join() === 'active,ended', `켠 상태가 보유-종료 순으로 묶여 표시 (${order})`);
  ok((await tile(0)) === '600000000', '종료를 함께 켜도 총계는 보유 기준');
  ok((await page.locator('.asset-group[data-state=ended]').innerText()).includes('해지'), '종료 사유 표시');

  // 종료 항목 → 휴지통 → 보유로 되돌리기
  await open('가상은행');
  await page.locator('.asset-state-box .btn', { hasText: '휴지통으로' }).click();
  await page.waitForSelector('.sheet', { state: 'detached' });
  await page.locator('.asset-toggle button', { hasText: '휴지통' }).click();
  const order2 = await page.locator('.asset-group').evaluateAll((gs) => gs.map((g) => g.dataset.state));
  ok(order2.join() === 'active,ended,trash', `세 상태 모두 켜면 보유-종료-휴지통 순 (${order2})`);
  await open('가상은행');
  await page.locator('.asset-state-box .btn', { hasText: '보유로 되돌리기' }).click();
  await page.waitForSelector('.sheet', { state: 'detached' });
  ok((await tile(0)) === '633000000', '보유로 되돌리면 합계 복귀');
  await open('가상은행');
  await page.locator('.asset-history summary').click();
  ok((await page.locator('.log-item').count()) === 5, '이력: 등록·수정·종료·휴지통·보유 5건');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.sheet', { state: 'detached' });

  // 완전 삭제
  await open('예시생명');
  await page.locator('.sheet-foot .btn.danger-ghost').click();
  await page.locator('.modal .btn.danger').click();
  await page.waitForSelector('.sheet', { state: 'detached' });
  ok((await page.locator('.asset-toggle button', { hasText: '보유' }).innerText()).includes('2'), '완전 삭제 후 보유 2건');
  ok((await page.locator('body').innerText()).includes('예시생명') === false, '완전 삭제한 항목은 어느 상태에도 없음');

  // 추이 아코디언: 맨 아래, 기본 접힘
  const tr = page.locator('.asset-trend');
  ok((await tr.evaluate((d) => d.open)) === false, '총액 추이는 기본으로 접힘');
  ok(await page.evaluate(() => { const v = document.querySelector('.assets-view .split-body') || document.querySelector('.assets-view'); return v.lastElementChild.classList.contains('asset-trend'); }), '총액 추이는 맨 아래');
  await tr.locator('summary').click();
  ok((await tr.innerText()).length > 10, '추이 펼침');

  ok(errs.length === 0, `콘솔/페이지 오류 없음 ${errs.join(' | ')}`);
  await page.screenshot({ path: `e2e/out/assets-${name}.png`, fullPage: true });
  await ctx.close();
}

await run('데스크톱', { width: 1280, height: 900 });
await run('모바일', { width: 390, height: 800 });
await browser.close();
console.log(failed ? `\n${failed}건 실패` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
