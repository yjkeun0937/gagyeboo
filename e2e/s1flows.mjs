// 지출 입력 창(금액 수식·필드 순서·계속 입력)과 통계 '전체 기간' 탭 검증
import { chromium } from 'playwright-core';
const URL = 'http://localhost:4173/gagyeboo/';
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
let failed = 0;
const ok = (cond, msg) => { if (!cond) { failed++; console.log('  FAIL:', msg); } else console.log('  ok:', msg); };
const ymd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);

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
  const openAdd = async () => { await (mobile ? page.locator('.fab') : page.locator('.add-btn')).click(); await page.waitForSelector('.sheet'); };
  const total = async () => (await page.locator('.stat-total .stat-value').innerText()).replace(/[^\d]/g, '');

  // 1) 필드 순서: 날짜 → 사용처 → 명세 → 금액 → 분류
  await openAdd();
  const order = await page.evaluate(() => [...document.querySelectorAll('.entry-form .field')].map((f) => (f.querySelector('label,.label')?.textContent || '').trim().replace(/\s+/g, ' ')));
  ok(order.slice(0, 5).join('|').replace(/원/, '') === '날짜|사용처|명세|금액 |분류'.replace('금액 ', '금액 ').replace(/원/, '') || (order[0] === '날짜' && order[1] === '사용처' && order[2] === '명세' && order[3].startsWith('금액') && order[4] === '분류'), `필드 순서 (${order.slice(0, 6).join(' / ')})`);

  // 2) 수식 입력
  const save = () => page.locator('.sheet-foot .btn.primary').click();
  await page.fill('#f-store', '수식마트');
  await page.fill('#f-amount', '500+1000');
  ok((await page.locator('.amount-preview').innerText()).includes('1,500'), '미리보기 = 1,500원');
  await save();
  await page.waitForSelector('.sheet', { state: 'detached' });
  ok((await total()) === '1500', '500+1000 → 1,500 저장');
  await openAdd();
  await page.fill('#f-store', '곱셈가게');
  await page.fill('#f-amount', '100*5+200');
  ok((await page.locator('.amount-preview').innerText()).includes('700'), '미리보기 = 700원');
  await save();
  await page.waitForSelector('.sheet', { state: 'detached' });
  ok((await total()) === '2200', '100*5+200 → 700 저장 (합계 2,200)');

  // 3) 잘못된 수식 → 경고 팝업, 저장 안 됨, 클릭하면 즉시 사라짐
  await openAdd();
  await page.fill('#f-store', '오류가게');
  await page.fill('#f-amount', '500++3');
  await save();
  await page.waitForSelector('.warning-pop');
  ok(true, '잘못된 수식: 경고 팝업 표시');
  ok((await page.locator('.sheet').count()) === 1, '경고 시 입력 창 유지');
  await page.mouse.click(vp.width / 2, vp.height / 2);
  await page.waitForSelector('.warning-pop', { state: 'detached', timeout: 500 });
  ok(true, '팝업을 누르면 즉시 사라짐');
  // '저장 후 계속 입력'도 같은 경고, 놔두면 저절로 사라짐
  await page.locator('.sheet-foot .btn', { hasText: '저장 후 계속 입력' }).click();
  await page.waitForSelector('.warning-pop');
  ok(true, '저장 후 계속 입력에서도 경고');
  await page.waitForSelector('.warning-pop', { state: 'detached', timeout: 5000 });
  ok(true, '놔두면 잠시 후 자동으로 사라짐');
  ok((await total()) === '2200', '잘못된 수식은 저장되지 않음');
  // Enter로 저장하려 해도 마찬가지
  await page.locator('#f-amount').press('Enter');
  await page.waitForSelector('.warning-pop');
  ok(true, 'Enter 저장에서도 경고');
  await page.mouse.click(vp.width / 2, vp.height / 2);

  // 4) 연산 버튼과 +1,000 버튼
  await page.fill('#f-amount', '300');
  await page.locator('.quick .op', { hasText: '×' }).click();
  await page.keyboard.type('4');
  ok((await page.inputValue('#f-amount')) === '300*4', '× 버튼: 300*4');
  ok((await page.locator('.amount-preview').innerText()).includes('1,200'), '미리보기 1,200');
  await page.locator('.quick .btn', { hasText: '+1,000' }).click();
  ok((await page.inputValue('#f-amount')) === '2,200', '+1,000 버튼은 수식 결과에 더함 (2200)');

  // 5) 저장 후 계속 입력: 명세·금액만 초기화
  await page.fill('#f-memo', '첫번째');
  await page.fill('#f-amount', '10+20');
  await page.locator('.sheet .chip', { hasText: '집밥' }).click();
  await page.locator('.sheet-foot .btn', { hasText: '저장 후 계속 입력' }).click();
  await page.waitForTimeout(300);
  ok((await page.inputValue('#f-memo')) === '' && (await page.inputValue('#f-amount')) === '', '명세·금액 초기화');
  ok((await page.inputValue('#f-store')) === '오류가게', '사용처 유지');
  ok((await page.locator('.sheet .chip[aria-pressed=true]', { hasText: '집밥' }).count()) === 1, '분류 유지');
  ok(await page.evaluate(() => document.activeElement?.id) === 'f-memo', '명세에 포커스');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.sheet', { state: 'detached' });
  ok((await total()) === '2230', '계속 입력 저장분 30원 반영 (합계 2,230)');

  // 6) 수정 창: 원래 금액은 그대로, 수식으로도 수정 가능
  const row = mobile ? page.locator('.card', { hasText: '곱셈가게' }).first() : page.locator('.ledger .row[tabindex]', { hasText: '곱셈가게' }).first();
  await row.click();
  await page.waitForSelector('.sheet');
  ok((await page.inputValue('#f-amount')) === '700', '수정 창에 700 표시');
  await page.fill('#f-amount', '700+300');
  await save();
  await page.waitForSelector('.sheet', { state: 'detached' });
  ok((await total()) === '2530', '수정: 700+300 → 1,000 (합계 2,530)');

  // 7) 전체 기간 통계 탭 (데이터: 오늘 + 작년 + 재작년)
  const now = new Date();
  const y = Number(ymd(now).slice(0, 4));
  for (const [d, store, amt] of [[`${y - 1}-03-10`, '작년마트', 40000], [`${y - 2}-11-05`, '재작년마트', 15000]]) {
    await openAdd();
    await page.fill('#f-store', store);
    await page.fill('#f-date', d);
    await page.fill('#f-amount', String(amt));
    await page.locator('.sheet .chip', { hasText: '집밥' }).click();
    await save();
    await page.waitForSelector('.sheet', { state: 'detached' });
  }
  await page.locator('.tab', { hasText: '통계' }).click();
  const tabs = await page.locator('.subtabs .subtab').allInnerTexts();
  ok(tabs.join(',') === '월간,연간,전체 기간,기간 지정', `탭 순서 (${tabs.join(',')})`);
  await page.locator('.subtab', { hasText: '전체 기간' }).click();
  await page.waitForSelector('.matrix.all-cats');
  const tiles = await page.locator('.tile').allInnerTexts();
  ok(tiles.length === 4 && tiles[0].includes('전체 합계') && tiles[0].includes('57,530'), `타일: 전체 합계 57,530 (${tiles[0].replace(/\s+/g, ' ')})`);
  ok(tiles[2].includes(`${y - 1}년 3월`) && tiles[2].includes('40,000'), '지출이 가장 많은 달');
  ok(tiles[3].includes('집밥'), '지출이 가장 많은 항목');
  const rows = await page.locator('.matrix.all-years tbody tr').count();
  ok(rows === 3, `연도별 요약 ${rows}행 (재작년~올해)`);
  const catHead = (await page.locator('.matrix.all-cats thead th').allInnerTexts()).join('|');
  ok(catHead.includes(`${y - 2}년`) && catHead.includes(`${y}년`) && catHead.includes('합계') && catHead.includes('연평균'), `분류×연 머리글 (${catHead})`);
  const hscroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  ok(hscroll, '페이지 가로 넘침 없음');
  // 칸 클릭 → 그 해·분류의 내역
  await page.locator('.matrix.all-cats .cell-btn', { hasText: '40,000' }).first().click();
  await page.waitForSelector('.row, .card');
  const txt = await page.locator('body').innerText();
  ok(txt.includes('작년마트') && !txt.includes('재작년마트'), '칸 클릭: 그 해 내역만 표시');
  ok(errs.length === 0, `콘솔/페이지 오류 없음 ${errs.join(' | ')}`);
  await ctx.close();
}

await run('데스크톱', { width: 1280, height: 860 });
await run('모바일', { width: 390, height: 800 });
await browser.close();
console.log(failed ? `\n${failed}건 실패` : '\n모두 통과');
process.exit(failed ? 1 : 0);
