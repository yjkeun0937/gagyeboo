// 고정지출 목록 2줄 표시, 구분 박스, 사용 토글(눈) 아이콘·툴팁, 사용 내역 → 고정지출 등록(+중복 안내)
import { chromium } from 'playwright-core';
const URL = 'http://localhost:4173/gagyeboo/';
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
let failed = 0;
const ok = (c, m) => { if (!c) { failed++; console.log('  FAIL:', m); } else console.log('  ok:', m); };

for (const [name, vp] of [['desktop', { width: 1280, height: 800 }], ['mobile', { width: 390, height: 780 }]]) {
  console.log(`\n[${name}]`);
  const mobile = vp.width <= 640;
  const ctx = await browser.newContext({ viewport: vp, locale: 'ko-KR', timezoneId: 'Asia/Seoul', hasTouch: mobile });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await page.goto(URL);
  await page.waitForSelector('.empty, .history');
  // 직접 입력한 내역 하나
  await (mobile ? page.locator('.fab:not(.queue-fab)') : page.locator('.add-btn')).click();
  await page.waitForSelector('.sheet');
  await page.fill('#f-store', '가상통신');
  await page.fill('#f-amount', '27450');
  await page.locator('.sheet-foot .btn.primary').click();
  await page.waitForSelector('.sheet', { state: 'detached' });
  // 수정 창 → 고정지출 등록
  await page.locator('.history').getByText('가상통신').first().click();
  await page.waitForSelector('.sheet');
  const reg = page.getByRole('button', { name: '고정지출 등록' });
  ok((await reg.count()) === 1, '내역 수정 창에 「고정지출 등록」 버튼');
  const footBtns = (await page.locator('.sheet .btn').allInnerTexts()).map((t) => t.trim());
  ok(footBtns.indexOf('고정지출 등록') < footBtns.indexOf('저장'), '저장 버튼 앞에 위치');
  await reg.click();
  await page.waitForSelector('.modal');
  ok((await page.locator('#fx-name').inputValue()) === '가상통신', '사용처가 항목 이름으로 채워짐');
  ok((await page.locator('.modal input[inputmode="numeric"]').first().inputValue()) === '27,450', '금액이 채워짐');
  ok((await page.locator('.fx-dup').count()) === 0, '직접 입력한 내역에는 중복 안내가 없음');
  await page.locator('.modal-foot .btn.primary').click();
  await page.waitForSelector('.modal', { state: 'detached' });

  // 목록 표시
  const row = page.locator('.list-row', { hasText: '가상통신' });
  ok((await row.count()) === 1, '고정지출 목록에 등록됨');
  const top = await row.locator('.lr-title').innerText();
  const bottom = await row.locator('.lr-meta').innerText();
  ok(top.includes('가상통신') && top.includes('27,450원') && top.includes('확정'), `윗줄: 이름·금액·확정 (${top.replace(/\s+/g, ' ')})`);
  ok(/매월 \d+일/.test(bottom) && bottom.includes('사용자 미지정'), `아랫줄: 일자·사용자 미지정 (${bottom})`);

  // 눈 버튼
  const eye = row.locator('.lr-actions .icon-btn').last();
  const icon = async () => await eye.locator('svg').getAttribute('class');
  ok(!/eye-off/i.test((await icon()) ?? ''), '사용 중이면 취소선 없는 눈');
  if (!mobile) {
    await eye.hover();
    await page.waitForSelector('.popover');
    ok((await page.locator('.popover-title').innerText()).trim() === '사용 중', '호버: 첫 줄 "사용 중"');
    ok((await page.locator('.popover-line').innerText()).trim() === '누르면 사용 안 함으로 바꿈', '호버: 둘째 줄');
    ok(Number(await page.locator('.popover-title').evaluate((el) => getComputedStyle(el).fontWeight)) >= 600, '첫 줄만 굵게');
    await eye.click();
    await page.waitForTimeout(150);
    ok((await page.locator('.popover-title').innerText()).trim() === '미사용', '클릭 후 툴팁 갱신: 미사용');
    ok((await page.locator('.popover-line').innerText()).trim() === '누르면 사용 중으로 바꿈', '클릭 후 둘째 줄');
  } else {
    await eye.click();
    await page.waitForTimeout(200);
  }
  ok(/eye-off/i.test((await icon()) ?? ''), '미사용이면 취소선 있는 눈');
  await eye.click();
  await page.waitForTimeout(150);
  ok(!/eye-off/i.test((await icon()) ?? ''), '다시 누르면 사용 중');

  // 구분 박스: 매월 / 특정월일, 폭 동일
  ok((await row.locator('.lr-kind').innerText()).trim() === '매월', '매월 항목은 「매월」 박스');
  await page.locator('.btn.small.primary', { hasText: '항목 추가' }).click();
  await page.waitForSelector('.modal');
  await page.fill('#fx-name', '가상보험');
  await page.locator('.modal input[inputmode="numeric"]').first().fill('1000');
  await page.locator('.segmented button', { hasText: '특정 월' }).click();
  await page.locator('.modal .chip', { hasText: /^3월$/ }).first().click();
  await page.locator('.modal-foot .btn.primary').click();
  await page.waitForSelector('.modal', { state: 'detached' });
  const ins = page.locator('.list-row', { hasText: '가상보험' });
  ok((await ins.locator('.lr-kind').innerText()).trim() === '특정월일', '특정 월 항목은 「특정월일」 박스');
  const kinds = await page.locator('.lr-kind').evaluateAll((els) => els.map((e) => [e.textContent.trim(), e.getBoundingClientRect().width, e.getBoundingClientRect().height]));
  ok(kinds.length === 2 && new Set(kinds.map((k) => k[1])).size === 1, `구분 박스 가로 폭 동일 (${JSON.stringify(kinds)})`);
  const lefts = await page.locator('.lr-title').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().left)));
  ok(new Set(lefts).size === 1, `이름 시작 위치가 같음 (${lefts})`);
  await page.screenshot({ path: `e2e/out/fixedlist-${name}.png` });

  // 고정지출에서 입력된 내역을 다시 고정지출로 등록하려 하면 안내
  await page.locator(mobile ? '.queue-fab' : '.queue-btn').click();
  await page.waitForSelector('.queue-window');
  for (let k = 0; k < 4 && !(await page.locator('.q-card').innerText()).includes('가상통신'); k++) await page.locator('.q-next').click();
  await page.locator('.q-enter').click();
  await page.locator('.q-apply').click();
  await page.waitForSelector('.queue-window', { state: 'detached' });
  await page.locator('.tab[data-tab="history"]').click();
  await page.waitForTimeout(500);
  const hits = page.locator('.history').getByText('가상통신');
  const n = await hits.count();
  ok(n === 2, `같은 이름의 내역이 둘 (${n})`);
  let shown = false;
  for (let i = 0; i < n && !shown; i++) {
    await hits.nth(i).click();
    await page.waitForSelector('.sheet');
    await page.getByRole('button', { name: '고정지출 등록' }).click();
    await page.waitForSelector('.modal');
    shown = (await page.locator('.modal .fx-dup').count()) > 0;
    if (shown) break;
    await page.locator('.modal-foot .btn', { hasText: '취소' }).click();
    await page.locator('.tab[data-tab="history"]').click();
    await page.waitForTimeout(300);
  }
  ok(shown, '고정지출에서 입력된 내역에서 등록 창을 열면 안내 표시');
  if (shown) {
    ok((await page.locator('.fx-dup').innerText()).includes('가상통신'), '안내에 원래 고정지출 이름');
    ok((await page.locator('#fx-name').inputValue()) === '가상통신' && (await page.locator('.modal-foot .btn.primary').isEnabled()), '막지는 않고 그대로 등록 가능');
    await page.screenshot({ path: `e2e/out/fixedlist-dup-${name}.png` });
  }
  ok(errs.length === 0, '콘솔 오류 없음 ' + errs.join(' | '));
  await ctx.close();
}
await browser.close();
console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
