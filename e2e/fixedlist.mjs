// 고정지출 목록 2줄 표시, 사용 토글(눈) 아이콘·툴팁, 사용 내역 → 고정지출 등록
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
  // 내역 하나 입력
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
  ok(footBtns.indexOf('고정지출 등록') < footBtns.indexOf('저장'), `저장 버튼 앞에 위치 (${footBtns.join('|')})`);
  await reg.click();
  await page.waitForSelector('.modal');
  ok((await page.locator('#fx-name').inputValue()) === '가상통신', '사용처가 항목 이름으로 채워짐');
  ok((await page.locator('.modal input[inputmode="numeric"]').first().inputValue()) === '27,450', '금액이 채워짐');
  ok((await page.locator('#fx-day').inputValue()) === String(Number(new Date().toLocaleDateString('sv', { timeZone: 'Asia/Seoul' }).slice(8, 10))), '입력일이 내역의 일자로 채워짐');
  ok((await page.locator('.modal-title, .modal h2').first().innerText()).includes('등록'), '등록 창으로 열림');
  await page.locator('.modal-foot .btn.primary').click();
  await page.waitForSelector('.modal', { state: 'detached' });

  // 목록 표시
  const row = page.locator('.list-row', { hasText: '가상통신' });
  ok((await row.count()) === 1, '고정지출 목록에 등록됨');
  const top = await row.locator('.lr-title').innerText();
  const bottom = await row.locator('.lr-meta').innerText();
  ok(top.includes('가상통신') && top.includes('27,450원') && top.includes('확정'), `윗줄: 이름·금액·확정 (${top.replace(/\s+/g, ' ')})`);
  ok(/매월 \d+일/.test(bottom) && bottom.includes('사용자 미지정'), `아랫줄: 일자·사용자 미지정 (${bottom})`);
  ok(!bottom.includes('null') && !/· $/.test(bottom), '지불수단·결제상세 미지정이면 표시 안 함');

  // 눈 버튼: 사용 중 = Eye(취소선 없음), 미사용 = EyeOff
  const eye = row.locator('.lr-actions .icon-btn').last();
  const icon = async () => await eye.locator('svg').getAttribute('class');
  const before = await icon();
  ok(/eye(?!-off)/i.test(before ?? '') && !/eye-off/i.test(before ?? ''), `사용 중이면 취소선 없는 눈 (${before})`);
  if (!mobile) {
    await eye.hover();
    await page.waitForSelector('.popover');
    ok((await page.locator('.popover-title').innerText()).trim() === '사용 중', '호버: 첫 줄 "사용 중"');
    ok((await page.locator('.popover-line').innerText()).trim() === '누르면 사용 안 함으로 바꿈', '호버: 둘째 줄');
    const w = await page.locator('.popover-title').evaluate((el) => getComputedStyle(el).fontWeight);
    ok(Number(w) >= 600, '첫 줄만 굵게');
    await eye.click();
    await page.waitForTimeout(150);
    ok((await page.locator('.popover-title').innerText()).trim() === '미사용', '클릭 후 툴팁 갱신: 미사용');
    ok((await page.locator('.popover-line').innerText()).trim() === '누르면 사용 중으로 바꿈', '클릭 후 둘째 줄');
  } else {
    await eye.click();
    await page.waitForTimeout(200);
  }
  const after = await icon();
  ok(/eye-off/i.test(after ?? ''), `미사용이면 취소선 있는 눈 (${after})`);
  await eye.click();
  await page.waitForTimeout(150);
  ok(!/eye-off/i.test((await icon()) ?? ''), '다시 누르면 사용 중');
  ok(errs.length === 0, '콘솔 오류 없음 ' + errs.join(' | '));
  await page.screenshot({ path: `e2e/out/fixedlist-${name}.png` });
  await ctx.close();
}
await browser.close();
console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
