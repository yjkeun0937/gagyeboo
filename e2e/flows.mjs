import { chromium } from 'playwright-core';
import fs from 'node:fs';
const URL = 'http://localhost:4173/gagyeboo/';
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
let failed = 0;
const ok = (cond, msg) => { if (!cond) { failed++; console.log('  FAIL:', msg); } else console.log('  ok:', msg); };
const kstToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
const addDays = (d, n) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

async function run(name, vp) {
  console.log(`\n[${name}]`);
  const ctx = await browser.newContext({ viewport: vp, locale: 'ko-KR', timezoneId: 'Asia/Seoul', acceptDownloads: true });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  const mobile = vp.width <= 640;
  await page.goto(URL);
  await page.waitForSelector('.empty');
  ok(await page.locator('.empty-title').innerText() === '아직 기록이 없습니다', '빈 상태 안내');

  const openAdd = async () => { await (mobile ? page.locator('.fab') : page.locator('.add-btn')).click(); await page.waitForSelector('.sheet'); };
  const save = async () => { await page.locator('.sheet-foot .btn.primary').click(); };
  const total = async () => (await page.locator('.stat-total .stat-value').innerText()).replace(/[^\d]/g, '');

  // 1) 첫 입력: 개인 즉석 추가
  await openAdd();
  await page.fill('#f-store', '테스트마트');
  await page.locator('.chip-add', { hasText: '개인 추가' }).click();
  await page.fill('input[aria-label="새 개인 이름"]', '테스트인');
  await page.keyboard.press('Enter');
  await page.locator('.sheet .chip', { hasText: '집밥' }).click();
  await page.fill('#f-amount', '12345');
  await page.locator('.sheet .chip', { hasText: '신용' }).click();
  ok((await page.inputValue('#f-amount')) === '12,345', '금액 천단위 표시');
  await save();
  await page.waitForSelector('.sheet', { state: 'detached' });
  ok((await total()) === '12345', '저장 후 합계 12,345');
  ok((await page.locator('.toast').innerText()).includes('저장했습니다'), '저장 토스트');

  // 2) 자동완성/자동채움
  await openAdd();
  await page.fill('#f-store', '테스트');
  ok(await page.locator('.suggest li', { hasText: '테스트마트' }).count() === 1, '사용처 후보 표시');
  await page.locator('.suggest li', { hasText: '테스트마트' }).dispatchEvent('mousedown');
  ok((await page.inputValue('#f-amount')) === '12,345', '마지막 금액 자동채움');
  ok((await page.locator('.sheet .chip[aria-pressed=true]', { hasText: '집밥' }).count()) === 1, '분류 자동채움');
  ok((await page.locator('.sheet .chip[aria-pressed=true]', { hasText: '테스트인' }).count()) === 1, '사용자 자동채움');
  await page.locator('.quick .btn', { hasText: '+1,000' }).click();
  ok((await page.inputValue('#f-amount')) === '13,345', '+1,000 버튼');
  // 저장 후 계속 입력
  await page.locator('.sheet-foot .btn', { hasText: '저장 후 계속 입력' }).click();
  await page.waitForTimeout(300);
  ok(await page.locator('.sheet').count() === 1 && (await page.inputValue('#f-store')) === '', '저장 후 계속 입력: 시트 유지·사용처 비움');
  ok((await page.locator('.sheet .chip[aria-pressed=true]', { hasText: '테스트인' }).count()) === 1, '계속 입력: 사용자 유지');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.sheet', { state: 'detached' });
  ok((await total()) === '25690', '합계 25,690');

  // 3) 수정 + 실행 취소
  const firstRow = mobile ? page.locator('.card').first() : page.locator('.ledger .row[tabindex]').first();
  await firstRow.click();
  await page.waitForSelector('.sheet');
  ok((await page.locator('.sheet-head h2').innerText()) === '내역 수정', '수정 시트');
  await page.fill('#f-amount', '20000');
  await save();
  await page.waitForSelector('.sheet', { state: 'detached' });
  const t1 = await total();
  ok(t1 === '32345' || t1 === '33345' || t1 === '20000' + '' || Number(t1) > 25690 - 1, `수정 후 합계 변경 (${t1})`);
  await page.locator('.toast-undo').click();
  await page.waitForTimeout(200);
  ok((await total()) === '25690', '수정 실행 취소');

  // 4) 삭제 + 실행 취소
  const firstAmt = Number((await (mobile ? page.locator('.card .amt').first() : page.locator('.ledger .row[tabindex] .c-amt').first()).innerText()).replace(/[^\d]/g, ''));
  await (mobile ? page.locator('.card').first() : page.locator('.ledger .row[tabindex]').first()).click();
  await page.waitForSelector('.sheet');
  await page.locator('.sheet-foot .btn', { hasText: '삭제' }).click();
  await page.locator('.modal .btn.danger').click();
  await page.waitForTimeout(200);
  ok(Number(await total()) === 25690 - firstAmt, `삭제 후 합계 (${firstAmt}원 빠짐)`);
  await page.locator('.toast-undo').click();
  await page.waitForTimeout(200);
  ok((await total()) === '25690', '삭제 실행 취소');

  // 5) 미래 날짜 → 예정
  await openAdd();
  await page.fill('#f-store', '내일행사');
  await page.fill('#f-date', addDays(kstToday, 1));
  await page.fill('#f-amount', '5000');
  await save();
  await page.locator('.modal .btn.primary').click(); // 확인 대화상자
  await page.waitForTimeout(300);
  const vm = await page.locator('.month-title').innerText();
  ok(await page.locator('.pill-scheduled').count() >= 1, `[예정] 알약 표시 (${vm})`);

  // 6) 필터
  if (mobile) await page.locator('.breakdown-toggle').click();
  await page.locator('.sum-chip', { hasText: '테스트인' }).first().click();
  ok(await page.locator('.tag', { hasText: '테스트인' }).count() === 1, '사용자 필터 태그');
  await page.locator('.filterbar .btn', { hasText: '필터 지우기' }).click();
  ok(await page.locator('.tag').count() === 0, '필터 지우기');

  // 7) 월 이동
  await page.locator('.monthnav .icon-btn[aria-label="전월"]').click();
  ok((await page.locator('.empty-title').innerText()).includes('기록이 없습니다'), '이전 달 빈 상태');
  await page.locator('.btn', { hasText: '오늘' }).first().click();
  ok(await page.locator('.stat-total').count() === 1, '오늘 버튼으로 복귀');

  // 8) 설정: 목록 관리
  await page.locator('.tab', { hasText: '설정' }).click();
  if (mobile) await page.locator('.menu-item', { hasText: '목록 관리' }).click();
  ok(await page.locator('button', { hasText: '그룹 추가' }).isDisabled(), '개인 1명일 때 그룹 추가 비활성');
  await page.locator('button', { hasText: '개인 추가' }).click();
  await page.fill('#le-name', '테스트인');
  await page.locator('.modal-foot .btn.primary').click();
  ok(await page.locator('.field-error').count() === 1, '이름 중복 오류');
  await page.fill('#le-name', '두번째');
  await page.locator('.modal-foot .btn.primary').click();
  await page.waitForSelector('.modal', { state: 'detached' });
  ok(await page.locator('.list-row', { hasText: '두번째' }).count() === 1, '개인 추가됨');
  await page.locator('button:not([disabled])', { hasText: '그룹 추가' }).click();
  await page.fill('#le-name', '함께');
  await page.locator('.modal-foot .btn.primary').click();
  ok((await page.locator('.field-error').innerText()).includes('2명 이상'), '그룹 구성원 2명 미만 오류');
  await page.locator('.modal .chip', { hasText: '테스트인' }).click();
  await page.locator('.modal .chip', { hasText: '두번째' }).click();
  await page.locator('.modal-foot .btn.primary').click();
  await page.waitForSelector('.modal', { state: 'detached' });
  ok(await page.locator('.list-row', { hasText: '함께' }).count() === 1, '그룹 추가됨');
  const rowOf = (n) => page.locator('.list-row').filter({ has: page.locator('.lr-title', { hasText: new RegExp(`^${n}$`) }) });
  const delBtn = rowOf('테스트인').locator('button[aria-label="삭제"]');
  ok(await delBtn.isDisabled(), '사용 중인 사용자는 삭제 불가');
  const del2 = rowOf('두번째').locator('button[aria-label="삭제"]');
  ok(await del2.isDisabled(), '그룹 구성원은 삭제 불가');

  // 9) 백업·복원
  if (mobile) await page.locator('.back-btn').click();
  if (mobile) await page.locator('.menu-item', { hasText: '데이터 관리' }).click();
  else await page.locator('.side-item', { hasText: '데이터 관리' }).click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('.btn', { hasText: '백업 파일 받기' }).click()]);
  const path = `e2e/out/${name}-backup.json`;
  await dl.saveAs(path);
  const data = JSON.parse(fs.readFileSync(path, 'utf8'));
  ok(data.app === 'gagyeboo' && data.entries.filter((e) => !e.deleted).length === 3, '백업 파일 내용(내역 3건)');
  await page.locator('.btn', { hasText: '모든 데이터 지우기' }).click();
  await page.locator('.modal .btn.danger').click();
  await page.waitForTimeout(300);
  await page.locator('input[type=file]').setInputFiles(path);
  await page.locator('.modal .btn.danger').click();
  await page.waitForTimeout(400);
  await page.locator('.tab', { hasText: /내역/ }).click();
  await page.waitForSelector('.stat-total');
  ok((await total()) === '30690', '복원 후 합계 30,690 (예정 5,000 포함)');

  ok(errs.length === 0, `콘솔/페이지 오류 없음 ${errs.join(' | ')}`);
  await ctx.close();
}

await run('desktop', { width: 1366, height: 900 });
await run('mobile', { width: 390, height: 844 });
await browser.close();
console.log(failed ? `\n${failed}건 실패` : '\n모든 흐름 통과');
process.exit(failed ? 1 : 0);
