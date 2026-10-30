import { chromium } from 'playwright-core';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

/**
 * R4 엑셀 가져오기·내보내기 흐름.
 * 가상 데이터 파일을 직접 만들어 쓴다. LEDGER=/경로/실제.xlsx 를 주면 실제 파일로도 한 번 더 확인한다(결과만 출력).
 */
const URL = 'http://localhost:4173/gagyeboo/';
const OUT = 'e2e/out';
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
let failed = 0;
const ok = (c, m) => { if (!c) { failed++; console.log('  FAIL:', m); } else console.log('  ok:', m); };

/* ───── 가상 엑셀 가계부 (이름·상호는 모두 지어낸 것) ───── */
const FIXTURE = `${OUT}/fake-ledger.xlsx`;
const py = `
import openpyxl, datetime
from openpyxl.styles import numbers
wb = openpyxl.Workbook(); wb.remove(wb.active)
def month(name, y, m, lines):
    ws = wb.create_sheet(name)
    ws['A1'] = datetime.datetime(y, m, 1); ws['A2'] = '금액합계'; ws['B2'] = '=SUM(F17:F500)'
    ws['A3'] = '사용자별 합계'; ws['A4'] = '하늘'; ws['B4'] = 1
    for c, h in zip('ABEFGH', ['날짜','사용처/명세','분류','금액','사용자','지불수단']): ws[c+'16'] = h
    ws.merge_cells('B16:D16')
    r = 17
    for l in lines:
        d, store, memo, cat, amt, user, pay, det = l
        if d: ws.cell(r,1,datetime.datetime(*d)).number_format = 'm"월" d"일" (ddd)'
        ws.cell(r,2,store); ws.cell(r,3,memo); ws.merge_cells(start_row=r,start_column=3,end_row=r,end_column=4)
        ws.cell(r,5,cat); ws.cell(r,6,amt); ws.cell(r,7,user); ws.cell(r,8,pay); ws.cell(r,9,det)
        r += 1
    ws['K16'] = '지출일'; ws['L16'] = '예상액'; ws['K17'] = '관리비'; ws['L17'] = 300000
month('2026-8', 2026, 8, [
  (None,'용돈','하늘','용돈',100000,'하늘','현금',None),
  ((2026,8,1),'샘플마트','장보기','집밥',30000,'우리집','신용','샘플카드'),
  (None,'샘플마트','과일','집밥',9000,'우리집','신용','샘플카드'),
  ((2026,8,2),'가상식당','점심','외식',12000,'바다','체크',None),
  ((2026,8,3),'샘플약국','약','의료건강비용',0,'구름','현금',None),
  (None,'메모만','있는 줄',None,None,None,None,None),
  ((2026,8,5),'예시버스','충전','교통비',20000,None,'현금',None)])
month('2026-9', 2026, 9, [
  ((2026,9,1),'샘플마트','장보기','집밥',41000,'우리집','신용','샘플카드'),
  ((2026,9,2),'가상식당','저녁','외식',22000,'하늘','체크',None),
  ((2026,9,3),'예시치킨','배달','외식',18000,'구름','페이','지역상품권')])
month('2026-10', 2026, 10, [
  ((2026,10,1),'샘플마트','장보기','집밥',35000,'우리집','신용','샘플카드'),
  ((2026,10,2),'가상서점','도서','교양오락문화생활',15000,'하늘','체크',None),
  ((2026,12,25),'예시공연','예매','교양오락문화생활',66000,'바다','신용','샘플카드')])
ws = wb.create_sheet('용돈'); ws['A1']='날짜'; ws['B1']='금액'; ws['A2']=datetime.datetime(2026,1,1); ws['B2']=5
wb.save('${FIXTURE}')
`;
const r = spawnSync('python3', ['-c', py], { encoding: 'utf8' });
if (r.status !== 0) { console.log(r.stderr); process.exit(1); }

/* 내려받은 엑셀을 openpyxl로 읽어 검사한다 (우리 읽기 모듈이 아닌 독립된 도구) */
function inspect(path) {
  const code = `
import openpyxl, json, sys
wb = openpyxl.load_workbook(sys.argv[1], data_only=True)
out = {}
for ws in wb.worksheets:
    out[ws.title] = [[c.value if not hasattr(c.value,'strftime') else c.value.strftime('%Y-%m-%d') for c in row] for row in ws.iter_rows()]
print(json.dumps(out, ensure_ascii=False))`;
  const x = spawnSync('python3', ['-c', code, path], { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (x.status !== 0) throw new Error(x.stderr);
  return JSON.parse(x.stdout);
}

async function open(name, vp, { files } = {}) {
  const ctx = await browser.newContext({ viewport: vp, locale: 'ko-KR', timezoneId: 'Asia/Seoul', acceptDownloads: true });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errs.push(m.text()));
  await page.goto(URL);
  await page.waitForSelector('.empty, .history');
  const mobile = vp.width <= 640;
  const d = { name, ctx, page, errs, mobile };
  d.gotoData = async () => {
    await page.locator('.tab', { hasText: '설정' }).click();
    await page.waitForTimeout(150);
    if (mobile) await page.locator('.menu-item', { hasText: '데이터 관리' }).click();
    else await page.locator('.side-item', { hasText: '데이터 관리' }).click();
    await page.waitForSelector('text=엑셀에서 가져오기');
  };
  d.db = (fn, arg) => page.evaluate(async ([src, a]) => {
    const db = await new Promise((res, rej) => { const q = indexedDB.open('gagyeboo'); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
    const all = (t) => new Promise((res) => { const q = db.transaction(t).objectStore(t).getAll(); q.onsuccess = () => res(q.result); });
    const data = { entries: (await all('entries')).filter((x) => !x.deleted), users: (await all('users')).filter((x) => !x.deleted), payDetails: (await all('payDetails')).filter((x) => !x.deleted), payMethods: (await all('payMethods')).filter((x) => !x.deleted), categories: (await all('categories')).filter((x) => !x.deleted) };
    db.close();
    return new Function('data', 'a', `return (${src})(data, a)`)(data, a);
  }, [fn.toString(), arg]);
  d.wizard = () => page.locator('.modal[aria-label="엑셀에서 가져오기"]');
  d.pickFile = async (path) => { await page.getByRole('button', { name: '엑셀에서 가져오기' }).click(); await page.waitForSelector('.modal[aria-label="엑셀에서 가져오기"]'); await page.locator('[data-testid=import-file]').setInputFiles(path); await page.waitForSelector('.wz-sheets'); };
  d.kind = async (user, label) => { const card = page.locator('.wz-user', { hasText: user }).first(); await card.locator('.wz-kinds button', { hasText: label }).click(); return card; };
  d.next = (re) => d.wizard().getByRole('button', { name: re });
  return d;
}

const D = { width: 1280, height: 900 };

console.log('\n[A] 파일 선택 → 시트·열 인식');
const A = await open('desktop', D);
await A.gotoData();
await A.pickFile(FIXTURE);
let t = await A.wizard().innerText();
ok((await A.page.locator('.wz-sheet input:checked').count()) === 3, '월 시트 3개가 자동 선택 (용돈 시트는 선택 안 됨)');
ok(/2026-8[\s\S]*6건 · 171,000원/.test(t) && /2026-9[\s\S]*3건 · 81,000원/.test(t) && /2026-10[\s\S]*3건 · 116,000원/.test(t), '시트별 건수·합계 표시');
ok(/12건을 읽었습니다/.test(t) && /금액이 비어 건너뛴 줄 1건/.test(t), '12건 읽음, 금액 빈 줄 1건 건너뜀');
ok(/열 구성[\s\S]*자동 인식/.test(t), '열 자동 인식');
await A.page.screenshot({ path: `${OUT}/r4-desktop-sheets.png` });
// 열 구성 보기
await A.page.locator('.wz-cols > summary').click();
const colSel = await A.page.locator('.wz-map-row select').evaluateAll((els) => els.map((e) => e.selectedOptions[0].textContent));
ok(colSel[0].startsWith('A열') && colSel[1].startsWith('B열') && colSel[2].startsWith('C열') && colSel[3].startsWith('E열') && colSel[4].startsWith('F열'), '날짜 A · 사용처 B · 명세 C · 분류 E · 금액 F: ' + colSel.slice(0, 5).join(' | '));
await A.page.locator('.wz-cols > summary').click();

console.log('\n[B] 사용자 확인');
await A.next(/다음: 사용자 확인/).click();
await A.page.waitForSelector('.wz-user');
ok((await A.page.locator('.wz-user').count()) === 4, '등록되지 않은 사용자 4종');
ok(await A.next(/다음: 미리보기/).isDisabled(), '구분을 고르기 전에는 다음으로 갈 수 없음');
ok(/사용자 칸이 빈 내역\s*1건/.test(await A.wizard().innerText()), '빈 사용자 칸 1건 안내');
await A.kind('하늘', '개인'); await A.kind('바다', '개인');
await A.kind('구름', '비움');
const g = await A.kind('우리집', '그룹');
ok(await A.next(/다음: 미리보기/).isDisabled(), '그룹 구성원이 없으면 막힘');
await g.locator('.chip', { hasText: '하늘' }).click();
ok(/구성원을 2명 이상/.test(await A.wizard().innerText()), '구성원 1명이면 안내');
await g.locator('.chip', { hasText: '바다' }).click();
ok(await A.next(/다음: 미리보기/).isEnabled(), '구성원 2명이면 통과');
await A.page.screenshot({ path: `${OUT}/r4-desktop-users.png` });
// 구름은 개인으로 바꿔 그룹 구성원에 추가
await A.kind('구름', '개인');
await g.locator('.chip', { hasText: '구름' }).click();

console.log('\n[C] 미리보기·확정');
await A.next(/다음: 미리보기/).click();
await A.page.waitForSelector('.wz-total');
t = await A.wizard().innerText();
ok(/10건 · 합계 268,000원/.test(t), '기본: 10건 · 268,000원 (날짜 없음·0원 줄은 빠짐)');
ok(/날짜 없음 1건/.test(t) && /금액 0원 1건/.test(t), '확인이 필요한 줄 2건 표시');
ok(/오늘 이후 날짜 1건은 \[예정\]/.test(t), '오늘 이후 날짜 안내');
ok(/사용자[\s\S]*우리집 \(그룹\)/.test(t), '새로 등록되는 사용자 안내');
await A.page.screenshot({ path: `${OUT}/r4-desktop-preview.png` });
await A.page.locator('.wz-flag-list li', { hasText: '금액 0원' }).locator('input').check();
ok(/11건 · 합계 268,000원/.test(await A.wizard().innerText()), '0원 줄을 체크하면 11건');
await A.page.locator('.wz-flag-list li', { hasText: '금액 0원' }).locator('input').uncheck();
await A.next(/10건 가져오기/).click();
await A.page.waitForSelector('.wz-done');
ok(/10건[\s\S]*가져왔습니다/.test(await A.wizard().innerText()), '완료 화면');
await A.page.screenshot({ path: `${OUT}/r4-desktop-done.png` });
await A.wizard().locator('.modal-foot').getByRole('button', { name: '닫기' }).click();
let db = await A.db((d) => ({
  n: d.entries.filter((e) => e.source === 'import').length,
  sum: d.entries.reduce((a, e) => a + e.amount, 0),
  users: d.users.map((u) => `${u.type}:${u.name}:${u.memberIds.length}`).sort(),
  details: d.payDetails.map((x) => x.name).sort(),
  linked: d.payDetails.every((p) => p.payMethodId),
  blankUser: d.entries.filter((e) => !e.user).length,
  batches: [...new Set(d.entries.map((e) => e.importBatchId))].length,
  order: d.entries.filter((e) => e.date === '2026-08-01').sort((a, b) => a.createdAt - b.createdAt).map((e) => e.memo),
}));
ok(db.n === 10 && db.sum === 268000, '저장: 10건 · 268,000원');
ok(JSON.stringify(db.users) === JSON.stringify(['group:우리집:3', 'person:구름:0', 'person:바다:0', 'person:하늘:0']), '사용자 등록: ' + db.users.join(','));
ok(db.details.join() === '샘플카드,지역상품권' && db.linked, '결제상세 2종이 지불수단에 연결됨');
ok(db.blankUser === 1, '사용자 칸이 빈 줄은 미지정으로');
ok(db.batches === 1 && db.order.join() === '장보기,과일', '묶음 ID 하나, 같은 날 입력 순서 유지');
ok((await A.page.getByText('마지막 가져오기: 남아 있는 내역').count()) === 1, '데이터 관리에 마지막 가져오기 표시');

console.log('\n[D] 같은 파일 다시 가져오기 → 중복 의심');
await A.pickFile(FIXTURE);
await A.next(/다음: 사용자 확인/).click(); // 사용자는 모두 등록됐지만 빈 사용자 칸 안내가 있다
await A.page.waitForSelector('.wz-matched');
await A.next(/다음: 미리보기/).click();
await A.page.waitForSelector('.wz-total');
t = await A.wizard().innerText();
ok(/0건 · 합계 0원/.test(t) && /중복 의심 10건/.test(t), '10건 모두 중복 의심으로 제외');
ok(await A.next(/가져오기/).last().isDisabled(), '가져올 내역이 없으면 버튼 비활성');
await A.wizard().getByRole('button', { name: '모두 포함' }).first().click();
ok(/10건 · 합계/.test(await A.wizard().innerText()), '중복도 직접 포함으로 바꿀 수 있음');
await A.wizard().locator('.modal-head .icon-btn').click();
await A.page.waitForTimeout(200);
ok((await A.db((d) => d.entries.length)) === 10, '취소하면 아무것도 저장되지 않음');

console.log('\n[E] 되돌리기');
await A.page.getByRole('button', { name: '마지막 가져오기 되돌리기' }).click();
await A.page.waitForSelector('.modal:has-text("마지막 가져오기를 되돌릴까요")');
await A.page.getByRole('button', { name: '되돌리기', exact: true }).click();
await A.page.waitForTimeout(500);
db = await A.db((d) => ({ n: d.entries.length, users: d.users.length, details: d.payDetails.length }));
ok(db.n === 0 && db.users === 0 && db.details === 0, '가져온 내역과 그때 새로 등록한 목록이 모두 사라짐');
ok((await A.page.getByText('마지막 가져오기: 남아 있는 내역').count()) === 0, '되돌린 뒤 표시도 사라짐');

console.log('\n[F] 내보내기 → 다시 가져오기');
// 다시 가져와서 데이터를 만든다 (이번에는 날짜 없음·0원 줄까지 모두 포함)
await A.pickFile(FIXTURE);
await A.next(/다음: 사용자 확인/).click();
await A.kind('하늘', '개인'); await A.kind('바다', '개인'); await A.kind('구름', '개인');
const g2 = await A.kind('우리집', '그룹');
for (const n of ['하늘', '바다', '구름']) await g2.locator('.chip', { hasText: n }).click();
await A.next(/다음: 미리보기/).click();
await A.page.waitForSelector('.wz-total');
for (const f of ['날짜 없음', '금액 0원']) await A.wizard().locator('.wz-flag-bulk', { hasText: f }).getByRole('button', { name: '모두 포함' }).click();
ok(/12건 · 합계 368,000원/.test(await A.wizard().innerText()), '날짜 없음·0원 포함 → 12건 · 368,000원');
await A.next(/12건 가져오기/).click();
await A.page.waitForSelector('.wz-done');
await A.wizard().locator('.modal-foot').getByRole('button', { name: '닫기' }).click();
ok((await A.db((d) => d.entries.find((e) => e.store === '용돈').date)) === '2026-08-01', '날짜 없던 줄은 그 달 1일로');

await A.page.getByRole('button', { name: '엑셀로 내보내기' }).click();
await A.page.waitForSelector('.modal[aria-label="엑셀로 내보내기"]');
ok(/12건을 내보냅니다/.test(await A.page.locator('.modal').innerText()), '내보낼 건수 표시');
await A.page.screenshot({ path: `${OUT}/r4-desktop-export.png` });
const [dl] = await Promise.all([A.page.waitForEvent('download'), A.page.getByRole('button', { name: '엑셀 파일 만들기' }).click()]);
const xlsxPath = `${OUT}/export-monthly.xlsx`;
await dl.saveAs(xlsxPath);
ok(/^gagyeboo-all-monthly-\d{4}-\d\d-\d\d\.xlsx$/.test(dl.suggestedFilename()) && dl.suggestedFilename().endsWith('.xlsx'), '파일 이름: ' + dl.suggestedFilename());
const x = inspect(xlsxPath);
ok(JSON.stringify(Object.keys(x)) === JSON.stringify(['2026-08', '2026-09', '2026-10', '2026-12', '2026 분류별', '사용자']), '시트 구성: ' + Object.keys(x).join(', '));
const aug = x['2026-08'];
const hdr = aug.findIndex((r) => r[0] === '날짜');
ok(JSON.stringify(aug[hdr].slice(0, 9)) === JSON.stringify(['날짜', '사용처', '명세', '분류', '금액', '사용자', '지불수단', '결제상세', '상태']), '머리글 줄');
const augRows = aug.slice(hdr + 1);
ok(augRows.length === 6 && augRows.reduce((a, r) => a + r[4], 0) === 171000, '8월 시트: 6건 · 171,000원');
ok(aug.flat().includes(171000) && aug[1][0] === '금액합계' && aug[1][1] === 171000, '월 요약의 금액합계');
ok(x['사용자'].some((r) => r[0] === '우리집' && r[1] === '그룹' && /하늘/.test(r[2])), '사용자 시트에 그룹 구성원');
ok(x['2026 분류별'].at(-3)[0] === '합계' || x['2026 분류별'].some((r) => r[0] === '합계'), '연간 분류별 시트');
// 엑셀 호환 확인: LibreOffice가 열어서 CSV로 바꿀 수 있는가
const lo = spawnSync('soffice', ['--headless', '--convert-to', 'csv', '--outdir', `${OUT}/lo`, xlsxPath], { encoding: 'utf8', timeout: 90000 });
const csvOut = fs.existsSync(`${OUT}/lo/export-monthly.csv`) ? fs.readFileSync(`${OUT}/lo/export-monthly.csv`, 'utf8') : '';
ok(lo.status === 0 && /샘플마트/.test(csvOut) && /30000|30,000/.test(csvOut), 'LibreOffice에서도 열림 (엑셀 호환 확인)');

// 단순 목록 + CSV
await A.page.getByRole('button', { name: '엑셀로 내보내기' }).click();
await A.page.waitForSelector('.modal[aria-label="엑셀로 내보내기"]');
await A.page.getByRole('button', { name: '단순 목록' }).click();
await A.page.getByRole('button', { name: '기간' }).click();
await A.page.getByLabel('시작일').fill('2026-09-01');
await A.page.getByLabel('종료일').fill('2026-10-31');
ok(/5건을 내보냅니다/.test(await A.page.locator('.modal').innerText()), '기간 9~10월 → 5건');
const [dl2] = await Promise.all([A.page.waitForEvent('download'), A.page.getByRole('button', { name: 'CSV', exact: true }).click()]);
await dl2.saveAs(`${OUT}/export.csv`);
const csv = fs.readFileSync(`${OUT}/export.csv`, 'utf8');
ok(csv.startsWith('﻿날짜,사용처,명세,분류,금액') && csv.trim().split('\r\n').length === 6, 'CSV: BOM + 머리글 + 5건');
await A.page.waitForSelector('.modal', { state: 'detached' });

// 내보낸 파일을 새 기기에서 가져오기 → 사용자 구분·구성원이 미리 채워진다
const B = await open('desktop-2', D);
await B.gotoData();
await B.pickFile(xlsxPath);
ok((await B.page.locator('.wz-sheet input:checked').count()) === 4, '내보낸 월 시트 4개 자동 선택 (분류별·사용자 시트는 제외)');
await B.next(/다음: 사용자 확인/).click();
await B.page.waitForSelector('.wz-user');
const pre = await B.page.locator('.wz-user').evaluateAll((els) => els.map((e) => `${e.querySelector('b').textContent}:${e.querySelector('.segmented [aria-pressed=true]')?.textContent}`).sort());
ok(pre.join() === '구름:개인,바다:개인,우리집:그룹,하늘:개인', '구분이 미리 채워짐: ' + pre.join(' '));
ok((await B.page.locator('.wz-members .chip[aria-pressed=true]').count()) === 3, '그룹 구성원 3명도 미리 선택됨');
await B.next(/다음: 미리보기/).click();
await B.page.waitForSelector('.wz-total');
ok(/11건 · 합계 368,000원/.test(await B.wizard().innerText()), '내보낸 파일을 다시 읽으면 11건 · 368,000원 (0원 줄은 기본 제외)');
await B.wizard().locator('.wz-flag-bulk', { hasText: '금액 0원' }).getByRole('button', { name: '모두 포함' }).click();
ok(/12건 · 합계 368,000원/.test(await B.wizard().innerText()), '0원 줄을 포함하면 12건');
await B.next(/12건 가져오기/).click();
await B.page.waitForSelector('.wz-done');
const same = await B.db((d) => d.entries.map((e) => `${e.date}|${e.store}|${e.memo}|${e.amount}`).sort());
const orig = await A.db((d) => d.entries.map((e) => `${e.date}|${e.store}|${e.memo}|${e.amount}`).sort());
ok(JSON.stringify(same) === JSON.stringify(orig), '왕복 후 내역이 모두 같음');

console.log('\n[G] 모바일 화면');
const M = await open('mobile', { width: 390, height: 844 });
await M.gotoData();
await M.pickFile(FIXTURE);
const fits = async (label) => {
  const r = await M.page.evaluate(() => {
    const m = document.querySelector('.modal');
    const rect = m.getBoundingClientRect();
    return { w: rect.width, sw: m.scrollWidth, cw: m.clientWidth, bodyOver: document.documentElement.scrollWidth > innerWidth, vw: innerWidth, bodyScroll: [...m.querySelectorAll('.modal-body')].map((b) => b.scrollWidth > b.clientWidth + 1) };
  });
  ok(r.w <= r.vw && r.sw <= r.cw + 1 && !r.bodyOver && !r.bodyScroll[0], `${label}: 화면 폭 안에 들어옴 ${JSON.stringify(r)}`);
};
await fits('시트 단계');
await M.page.screenshot({ path: `${OUT}/r4-mobile-sheets.png` });
await M.next(/다음: 사용자 확인/).click();
await M.page.waitForSelector('.wz-user');
await M.kind('하늘', '개인'); await M.kind('바다', '개인'); await M.kind('구름', '개인');
const mg = await M.kind('우리집', '그룹');
for (const n of ['하늘', '바다']) await mg.locator('.chip', { hasText: n }).click();
await fits('사용자 단계');
await M.page.screenshot({ path: `${OUT}/r4-mobile-users.png` });
await M.next(/다음: 미리보기/).click();
await M.page.waitForSelector('.wz-total');
await fits('미리보기 단계');
await M.page.screenshot({ path: `${OUT}/r4-mobile-preview.png` });
await M.next(/10건 가져오기/).click();
await M.page.waitForSelector('.wz-done');
await M.wizard().locator('.modal-foot').getByRole('button', { name: '닫기' }).click();
await M.page.getByRole('button', { name: '엑셀로 내보내기' }).click();
await M.page.waitForSelector('.modal[aria-label="엑셀로 내보내기"]');
await fits('내보내기');
await M.page.screenshot({ path: `${OUT}/r4-mobile-export.png` });

/* ───── 실제 파일(선택) ───── */
if (process.env.LEDGER) {
  console.log('\n[H] 실제 엑셀 파일로 확인 (내용은 출력하지 않음)');
  const R = await open('real', D);
  await R.gotoData();
  await R.pickFile(process.env.LEDGER);
  ok((await R.page.locator('.wz-sheet input:checked').count()) === 12, '월 시트 12개 선택');
  ok(/1,101건을 읽었습니다/.test(await R.wizard().innerText()), '1,101건 읽음');
  await R.next(/다음: 사용자 확인/).click();
  await R.page.waitForSelector('.wz-user');
  const names = await R.page.locator('.wz-user b').allInnerTexts();
  ok(names.length === 7, '사용자 7종 (개인·그룹 구분은 직접 지정): ' + names.length);
  // 이름 모양으로 추정하지 않고, 이 시험에서는 고정된 가정으로 지정한다: 앞 4종(건수 순이 아니라 이름) 개인, 나머지 그룹
  const personNames = ['이경', '재근', '동교', '동윤'];
  for (const n of names.filter((n) => personNames.includes(n))) await R.kind(n, '개인');
  for (const n of names.filter((n) => !personNames.includes(n))) {
    const card = await R.kind(n, '그룹');
    for (const m of personNames.slice(0, 2)) await card.locator('.chip', { hasText: m }).click();
  }
  await R.next(/다음: 미리보기/).click();
  await R.page.waitForSelector('.wz-total');
  const pt = await R.wizard().innerText();
  ok(/1,099건 · 합계 60,231,418원/.test(pt), '1,099건 · 60,231,418원 (엑셀 월 합계의 합과 같음, 0원 2건 제외)');
  ok(/금액 0원 2건/.test(pt) && /오늘 이후 날짜 8건/.test(pt), '0원 2건, 오늘 이후 8건 안내');
  await R.next(/1,099건 가져오기/).click();
  await R.page.waitForSelector('.wz-done');
  const rd = await R.db((d) => ({ n: d.entries.length, sum: d.entries.reduce((a, e) => a + e.amount, 0), cats: d.categories.length, det: d.payDetails.length, usr: d.users.length }));
  ok(rd.n === 1099 && Math.abs(rd.sum - 60231417.5) < 1e-6, `저장 1,099건 · 합계 일치 (분류 ${rd.cats}, 결제상세 ${rd.det}, 사용자 ${rd.usr})`);
  await R.wizard().locator('.modal-foot').getByRole('button', { name: '닫기' }).click();
  const [dlr] = await Promise.all([R.page.waitForEvent('download'), (async () => { await R.page.getByRole('button', { name: '엑셀로 내보내기' }).click(); await R.page.getByRole('button', { name: '엑셀 파일 만들기' }).click(); })()]);
  await dlr.saveAs(`${OUT}/real-export.xlsx`);
  const rx = inspect(`${OUT}/real-export.xlsx`);
  const months = Object.keys(rx).filter((k) => /^2026-\d\d$/.test(k));
  ok(months.length === 12, '내보낸 월 시트 12개');
  let cnt = 0; let sm = 0;
  for (const k of months) { const rows = rx[k]; const h = rows.findIndex((r) => r[0] === '날짜'); for (const r of rows.slice(h + 1)) { cnt++; sm += r[4]; } }
  ok(cnt === 1099 && Math.abs(sm - 60231417.5) < 1e-6, '내보낸 파일의 건수·합계가 같음');
  ok(R.errs.length === 0, '콘솔 오류 없음 ' + R.errs.join(' | '));
  await R.ctx.close();
}

console.log('\n[I] 오류');
ok([A, B, M].every((d) => d.errs.length === 0), '콘솔 오류 없음 ' + [A, B, M].flatMap((d) => d.errs).join(' | '));

await browser.close();
console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
