// 엑셀 가져오기: 미등록 이름을 기존 사용자로 변환 (비슷한 이름 제안 포함)
import { chromium } from 'playwright-core';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
const URL = 'http://localhost:4173/gagyeboo/';
const OUT = 'e2e/out';
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
let failed = 0;
const ok = (c, m) => { if (!c) { failed++; console.log('  FAIL:', m); } else console.log('  ok:', m); };

const mk = (file, month, lines) => {
  const py = `
import openpyxl, datetime
wb = openpyxl.Workbook(); wb.remove(wb.active)
ws = wb.create_sheet('${month}')
ws['A1'] = datetime.datetime(2026, ${Number(month.split('-')[1])}, 1)
for c, h in zip('ABEFGH', ['날짜','사용처/명세','분류','금액','사용자','지불수단']): ws[c+'16'] = h
r = 17
for d, store, amt, user in ${JSON.stringify(lines)}:
    ws.cell(r,1,datetime.datetime(2026, ${Number(month.split('-')[1])}, d)); ws.cell(r,2,store); ws.cell(r,5,'외식'); ws.cell(r,6,amt); ws.cell(r,7,user); ws.cell(r,8,'현금'); r += 1
wb.save('${file}')`;
  const x = spawnSync('python3', ['-c', py], { encoding: 'utf8' });
  if (x.status !== 0) { console.log(x.stderr); process.exit(1); }
};
const F1 = `${OUT}/users-1.xlsx`, F2 = `${OUT}/users-2.xlsx`;
mk(F1, '2026-8', [[1, '가상식당', 10000, '바다'], [2, '가상식당', 5000, '하늘']]);
mk(F2, '2026-9', [[1, '샘플마트', 7000, '김바다'], [2, '샘플마트', 3000, '김바다'], [3, '예시치킨', 4000, '구름']]);

const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(URL);
await page.waitForSelector('.empty, .history');
const wiz = () => page.locator('.modal[aria-label="엑셀에서 가져오기"]');
const next = (re) => wiz().getByRole('button', { name: re });
const importFile = async (path) => {
  await page.locator('.tab', { hasText: '설정' }).click();
  await page.locator('.side-item', { hasText: '데이터 관리' }).click();
  await page.getByRole('button', { name: '엑셀에서 가져오기' }).click();
  await page.waitForSelector('.modal[aria-label="엑셀에서 가져오기"]');
  await page.locator('[data-testid=import-file]').setInputFiles(path);
  await page.waitForSelector('.wz-sheets');
  await next(/다음: 사용자 확인/).click();
  await page.waitForSelector('.wz-user');
};
const card = (name) => page.locator('.wz-user', { has: page.locator('b', { hasText: new RegExp(`^${name}$`) }) });
const db = (fn) => page.evaluate(async (src) => {
  const d = await new Promise((res) => { const q = indexedDB.open('gagyeboo'); q.onsuccess = () => res(q.result); });
  const all = (t) => new Promise((res) => { const q = d.transaction(t).objectStore(t).getAll(); q.onsuccess = () => res(q.result); });
  const data = { entries: (await all('entries')).filter((x) => !x.deleted), users: (await all('users')).filter((x) => !x.deleted) };
  d.close();
  return new Function('data', `return (${src})(data)`)(data);
}, fn.toString());

console.log('\n[1] 먼저 바다·하늘을 개인으로 등록');
await importFile(F1);
await card('바다').locator('.wz-kinds button', { hasText: '개인' }).click();
await card('하늘').locator('.wz-kinds button', { hasText: '개인' }).click();
await next(/다음: 미리보기/).click();
await page.waitForSelector('.wz-total');
await next(/2건 가져오기/).click();
await page.waitForSelector('.wz-done');
await wiz().getByRole('button', { name: /닫기|완료/ }).first().click();

console.log('\n[2] 김바다·구름이 든 파일 가져오기');
await importFile(F2);
ok((await card('김바다').locator('.wz-similar .chip').allInnerTexts()).join() === '변환 → 바다', '김바다: 「바다」로 변환 제안');
ok((await card('구름').locator('.wz-similar').count()) === 0, '구름: 제안 없음');
ok((await card('김바다').locator('.wz-kinds button', { hasText: '기존 사용자로 변환' }).count()) === 1, '버튼 이름 「기존 사용자로 변환」');
ok(await next(/다음: 미리보기/).isDisabled(), '고르기 전에는 다음 불가');
await card('김바다').locator('.wz-similar .chip').click();
const sel = await card('김바다').locator('select').evaluate((e) => e.selectedOptions[0].textContent);
ok(sel.startsWith('바다'), `제안을 누르면 변환 대상이 바다로 선택됨 (${sel})`);
// 구름은 다른 그룹/이름 없이 직접 고른 기존 사용자로 변환 (하늘)
await card('구름').locator('.wz-kinds button', { hasText: '기존 사용자로 변환' }).click();
await card('구름').locator('select').selectOption({ label: '하늘 (개인)' });
await next(/다음: 미리보기/).click();
await page.waitForSelector('.wz-total');
ok(/새로 등록[\s\S]*없음|새로 등록할 사용자가 없/.test(await wiz().innerText()) || !/김바다|구름/.test((await wiz().locator('.wz-new, .wz-newlist').allInnerTexts().catch(() => [])).join()), '새 사용자는 등록되지 않음');
await next(/3건 가져오기/).click();
await page.waitForSelector('.wz-done');
const res = await db((d) => ({
  users: d.users.map((u) => u.name).sort().join(),
  byStore: d.entries.filter((e) => e.date >= '2026-09').map((e) => `${e.store}:${d.users.find((u) => u.id === e.user)?.name}`).sort().join(),
}));
ok(res.users === '바다,하늘', `사용자는 바다·하늘뿐 (${res.users})`);
ok(res.byStore === '샘플마트:바다,샘플마트:바다,예시치킨:하늘', `내역 사용자 변환됨 (${res.byStore})`);
ok(errs.length === 0, '페이지 오류 없음 ' + errs.join('|'));
await browser.close();
console.log(failed ? `\n${failed}건 실패` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
