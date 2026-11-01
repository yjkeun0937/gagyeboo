// 입력 대기: 버튼(데스크탑·모바일), 창(이동·선택·적용·닫기 확인·실행 취소), 고정지출 등록 안내 문구
import { chromium } from 'playwright-core';
const URL = 'http://localhost:4173/gagyeboo/';
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
let failed = 0;
const ok = (cond, msg) => { if (!cond) { failed++; console.log('  FAIL:', msg); } else console.log('  ok:', msg); };

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
  ok((await page.locator('.queue-btn, .queue-fab').count()) === 0, '대기 건이 없으면 버튼이 없음');

  // 고정지출 3개 등록 (이번 달부터)
  await page.locator('.tab[data-tab="settings"]').click();
  if (mobile) await page.locator('.menu-item', { hasText: '고정지출' }).click(); else await page.locator('.side-item', { hasText: '고정지출' }).click();
  const add = async (n, amount, day) => {
    await page.getByRole('button', { name: /항목 추가/ }).first().click();
    await page.waitForSelector('.modal');
    if (n === '관리비') ok((await page.locator('.fx-notice').innerText()).includes('입력하지 않음'), '등록 창에 이번 달부터 추가·제외 방법 안내');
    await page.fill('.modal input[aria-label="항목 이름"], .modal #fx-name', n).catch(async () => { await page.locator('.modal input').first().fill(n); });
    await page.locator('.modal input[inputmode="numeric"]').first().fill(String(amount));
    await page.locator('#fx-day').selectOption(String(day));
    await page.locator('.modal-foot .btn.primary').click();
    await page.waitForSelector('.modal', { state: 'detached' });
  };
  await add('관리비', 100000, 28);
  await add('통신비', 54000, 15);
  await add('보험료', 38000, 3);
  const btn = page.locator(mobile ? '.queue-fab' : '.queue-btn');
  ok((await btn.count()) === 1, '등록하면 이번 달 항목이 입력 대기로 올라옴 (버튼 나타남)');
  const label = (await btn.innerText()).replace(/\s+/g, ' ').trim();
  ok(mobile ? /대기 3/.test(label) : label.includes('입력 대기(3건)'), `버튼에 건수 표시 (${label})`);
  if (mobile) {
    const g = await page.evaluate(() => { const q = document.querySelector('.queue-fab').getBoundingClientRect(); const f = document.querySelector('.fab:not(.queue-fab)'); return { qRight: q.right, fabLeft: f ? f.getBoundingClientRect().left : null, w: q.width, h: q.height }; });
    ok(Math.abs(g.w - 56) < 1 && Math.abs(g.h - 56) < 1, '모바일 대기 버튼은 둥근 버튼');
    ok(await page.locator('.queue-fab .qf-label').innerText() === '대기', '두 줄: 윗줄 「대기」');
    await page.locator('.tab[data-tab="history"]').click();
    const g2 = await page.evaluate(() => { const q = document.querySelector('.queue-fab').getBoundingClientRect(); const f = document.querySelector('.fab:not(.queue-fab)').getBoundingClientRect(); return { gap: f.left - q.right }; });
    ok(g2.gap > 4 && g2.gap < 30, `+ 버튼 왼쪽에 나란히 (간격 ${Math.round(g2.gap)})`);
  } else {
    const order = await page.evaluate(() => [...document.querySelectorAll('.top-actions > *')].map((e) => (e.classList.contains('add-btn') ? 'add' : e.classList.contains('queue-btn') ? 'queue' : 'other')).join('|'));
    ok(order === 'add|queue|other', `지출 입력 뒤, 계정 칩 앞 (${order})`);
  }

  // 창 열기
  await btn.click();
  await page.waitForSelector('.queue-window');
  ok((await page.locator('.q-count').innerText()).replace(/\s/g, '') === '1/3', '1 / 3 표시');
  ok(await page.locator('.q-prev').isDisabled(), '첫 건에서는 이전 이동 비활성');
  ok(await page.locator('.q-apply').isDisabled(), '선택이 없으면 적용 비활성');
  const first = await page.locator('.q-card').innerText();
  ok(first.includes('고정지출') && first.includes('입력됩니다') && first.includes('사용처') && first.includes('명세') && first.includes('금액'), '월·사용처·명세·금액 등 표시');
  // 날짜순: 보험료(3일) → 통신비(15일) → 관리비(28일)
  ok(first.includes('보험료'), '날짜순 정렬 (3일 건이 먼저)');
  await page.locator('.q-enter').click();
  ok((await page.locator('.q-count').innerText()).replace(/\s/g, '') === '1/3', '선택해도 자동으로 다음 건으로 넘어가지 않음');
  ok((await page.locator('.q-enter').getAttribute('aria-pressed')) === 'true', '입력 선택 표시');
  await page.locator('.q-enter').click();
  ok((await page.locator('.q-enter').getAttribute('aria-pressed')) === 'false', '다시 누르면 선택 해제');
  await page.locator('.q-enter').click();
  await page.locator('.q-next').click();
  ok((await page.locator('.q-card').innerText()).includes('통신비'), '다음 건 이동');
  await page.locator('.q-skip').click();
  ok((await page.locator('.q-apply').innerText()).includes('입력 1') && (await page.locator('.q-apply').innerText()).includes('제외 1'), '적용 버튼에 선택 건수');

  // 선택이 있는 채로 닫기 → 확인
  await page.keyboard.press('Escape');
  await page.waitForSelector('.modal .confirm-msg');
  await page.locator('.modal-foot .btn', { hasText: '계속 고르기' }).click();
  ok((await page.locator('.queue-window').count()) === 1, '닫기 확인에서 계속 고르면 창 유지');

  // 적용
  await page.locator('.q-apply').click();
  await page.waitForTimeout(400);
  ok((await page.locator('.queue-window').count()) === 0, '적용하면 창이 닫힘');
  const left = (await btn.innerText()).replace(/\s+/g, ' ');
  ok(mobile ? /대기 1/.test(left) : left.includes('입력 대기(1건)'), `처리하지 않은 건은 남음 (${left})`);
  await page.locator('.tab[data-tab="history"]').click();
  await page.waitForTimeout(300);
  ok((await page.locator('.ledger, .cards').innerText()).includes('보험료'), '입력한 건이 사용 내역에 있음');
  ok(!(await page.locator('.ledger, .cards').innerText()).includes('통신비'), '입력하지 않음 건은 내역에 없음');

  // 실행 취소
  await page.locator('.toast-undo').click();
  await page.waitForTimeout(400);
  const back = (await btn.innerText()).replace(/\s+/g, ' ');
  ok(mobile ? /대기 3/.test(back) : back.includes('입력 대기(3건)'), `실행 취소하면 3건으로 복귀 (${back})`);

  // 다시 전부 처리하면 버튼이 사라짐
  await btn.click();
  await page.waitForSelector('.queue-window');
  for (let i = 0; i < 3; i++) { await page.locator('.q-skip').click(); if (i < 2) await page.locator('.q-next').click(); }
  await page.locator('.q-apply').click();
  await page.waitForTimeout(400);
  ok((await page.locator('.queue-btn, .queue-fab').count()) === 0, '모두 처리하면 버튼이 사라짐');
  ok(errs.length === 0, '콘솔/페이지 오류 없음 ' + errs.join('|'));
  await page.screenshot({ path: `e2e/out/queue-${name}.png` });
  await ctx.close();
}
await run('desktop', { width: 1280, height: 800 });
await run('mobile', { width: 390, height: 780 });

// 열 때 알림
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  const page = await ctx.newPage();
  await page.goto(URL);
  await page.waitForSelector('.empty, .history');
  await page.getByText('가상 데이터로 둘러보기').click();
  await page.waitForSelector('.ledger');
  await page.reload();
  await page.waitForSelector('.ledger, .cards');
  await page.waitForSelector('.toast', { timeout: 4000 }).catch(() => {});
  ok(((await page.locator('.toast').innerText().catch(() => '')) || '').includes('입력 대기'), '앱을 열면 입력 대기 알림이 한 번 뜸');
  ok((await page.locator('.modal').count()) === 0, '창은 자동으로 열리지 않음');
  await ctx.close();
}
await browser.close();
console.log(failed ? `\n${failed}건 실패` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
