import { chromium } from 'playwright-core';
import { FakeGoogle } from './fakeGoogle.mjs';
const URL = 'http://localhost:4173/gagyeboo/';
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const google = new FakeGoogle();
let failed = 0;
const ok = (c, m) => { if (!c) { failed++; console.log('  FAIL:', m); } else console.log('  ok:', m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CID = '1234567890-test.apps.googleusercontent.com';

async function device(name, vp, { clientId = true, account } = {}) {
  const ctx = await browser.newContext({ viewport: vp, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  await google.install(ctx);
  await ctx.addInitScript(([cid, acct]) => {
    if (cid && !localStorage.getItem('gagyeboo.clientId')) localStorage.setItem('gagyeboo.clientId', cid);
    if (acct) localStorage.setItem('fakeAccount', acct);
  }, [clientId ? CID : '', account || '']);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errs.push(m.text()));
  await page.goto(URL);
  await page.waitForSelector('.empty, .history');
  const d = { name, ctx, page, errs, vp, mobile: vp.width <= 640 };
  d.chip = () => page.locator('.account-chip');
  d.status = async () => (await d.chip().getAttribute('class')).match(/is-(\w+)/)?.[1];
  d.waitStatus = async (st, t = 8000) => { await page.waitForSelector(`.account-chip.is-${st}`, { timeout: t }); };
  d.total = async () => (await page.locator('.stat-total .stat-value').innerText()).replace(/[^\d]/g, '');
  d.openAccount = async () => { if (!(await page.locator('.modal').count())) await d.chip().click(); await page.waitForSelector('.modal'); };
  d.closeModal = async () => { await page.keyboard.press('Escape'); await page.waitForTimeout(150); };
  d.signIn = async () => { await d.openAccount(); await page.getByRole('button', { name: '구글 계정으로 로그인' }).click(); };
  d.syncNow = async () => { await d.openAccount(); await page.getByRole('button', { name: '지금 동기화' }).click(); await page.waitForTimeout(150); await d.closeModal(); };
  d.addEntry = async (store, amount) => {
    await (d.mobile ? page.locator('.fab') : page.locator('.add-btn')).click();
    await page.waitForSelector('.sheet');
    await page.fill('#f-store', store);
    await page.fill('#f-amount', String(amount));
    await page.locator('.sheet-foot .btn.primary').click();
    await page.waitForSelector('.sheet', { state: 'detached' });
  };
  d.sample = async () => { await page.getByText('가상 데이터로 둘러보기').first().click(); await page.waitForSelector('.ledger, .cards'); await page.waitForTimeout(400); if (await page.locator('.modal.is-wide').count()) { await page.keyboard.press('Escape'); await page.waitForTimeout(200); } };
  return d;
}

console.log('\n[A] 로컬 모드 안내');
const A = await device('desktop', { width: 1366, height: 900 }, { clientId: false });
ok((await A.status()) === 'local', '처음에는 로컬 모드');
ok((await A.chip().innerText()).includes('로그인하면 다른 기기와 동기화'), '로그인 안내 문구가 항상 보임');
await A.openAccount();
ok((await A.page.getByText('구글 클라이언트 ID를 한 번 설정').count()) === 1, '클라이언트 ID가 없으면 설정 안내');
await A.page.getByRole('button', { name: '설정 방법 보기' }).click();
await A.page.waitForSelector('.guide');
ok(!(await A.page.locator('.guide code.copy').isVisible()), '(안내는 접혀 있음)');
await A.page.locator('.guide summary').click();
ok((await A.page.locator('.guide code.copy').innerText()) === 'http://localhost:4173', '이 앱 주소(승인된 원본)를 안내');
await A.page.fill('#cid', CID);
await A.page.getByRole('button', { name: '저장', exact: true }).click();
await A.page.screenshot({ path: 'e2e/out/r3-desktop-settings-account.png', fullPage: true });
await A.page.locator('.tab[data-tab="history"]').click();
await A.sample();
const total0 = await A.total();
console.log('  sample total', total0);

console.log('\n[B] 첫 로그인(드라이브 비어 있음) → 올리기');
await A.page.screenshot({ path: 'e2e/out/r3-desktop-local.png' });
await A.signIn();
await A.waitStatus('idle');
ok(google.files().map((f) => f.name).sort().join() === 'entries-2026.json,meta.json', '드라이브에 meta.json과 entries-2026.json 생성: ' + google.files().map((f) => f.name));
const remoteCount = google.json('entries-2026.json').entries.filter((e) => !e.deleted).length;
ok(remoteCount > 50, `드라이브에 내역 ${remoteCount}건`);
ok((await A.chip().innerText()).includes('동기화됨'), '칩이 "동기화됨"');
ok((await A.page.locator('.toast').innerText()).includes('alice@example.com'), '로그인 토스트');
await A.page.screenshot({ path: 'e2e/out/r3-desktop-synced.png' });
await A.openAccount();
await A.page.screenshot({ path: 'e2e/out/r3-desktop-modal.png' });
ok((await A.page.locator('.account-panel').innerText()).includes('방금 전에 동기화했습니다'), '모달에 마지막 동기화 시각');
await A.closeModal();

console.log('\n[C] 두 번째 기기(모바일): 로그인하면 받아 온다');
const Bm = await device('mobile', { width: 390, height: 844 });
ok((await Bm.status()) === 'local', '새 기기는 로컬 모드');
await Bm.signIn();
await Bm.waitStatus('idle');
await Bm.page.waitForSelector('.cards, .ledger');
ok((await Bm.total()) === total0, `모바일 합계가 데스크톱과 같음 (${total0})`);
ok((await Bm.page.getByText('이 기기의 데이터와 합칩니다').count()) === 0, '이 기기가 비어 있으면 합치기 확인 창 없이 바로 받음');
await Bm.page.screenshot({ path: 'e2e/out/r3-mobile-synced.png' });

console.log('\n[D] 입력 → 몇 초 뒤 자동 업로드 → 다른 기기에서 받기');
await A.addEntry('동기화테스트마트', 7777);
const before = google.json('entries-2026.json').entries.length;
await sleep(4500);
const after = google.json('entries-2026.json').entries;
ok(after.length === before + 1 && after.some((e) => e.store === '동기화테스트마트' && e.amount === 7777), '변경 3초 뒤 자동으로 드라이브에 올라감');
await Bm.syncNow();
await Bm.waitStatus('idle');
await Bm.page.waitForTimeout(300);
ok((await Bm.page.getByText('동기화테스트마트').count()) >= 1, '모바일에서 「지금 동기화」로 새 내역을 받음');
// 모바일에서 삭제 → 데스크톱에 전파
await Bm.page.getByText('동기화테스트마트').first().click();
await Bm.page.waitForSelector('.sheet');
await Bm.page.locator('.sheet .btn.danger-ghost').click();
await Bm.page.locator('.modal .btn.danger').click();
await Bm.page.waitForTimeout(400);
ok((await Bm.page.getByText('동기화테스트마트').count()) === 0, '모바일에서 삭제');
await Bm.syncNow();
await Bm.waitStatus('idle');
await A.syncNow();
await A.waitStatus('idle');
await A.page.waitForTimeout(300);
ok((await A.page.getByText('동기화테스트마트').count()) === 0, '삭제가 데스크톱에도 전파');
ok(google.json('entries-2026.json').entries.find((e) => e.store === '동기화테스트마트')?.deleted === true, '드라이브에는 삭제 표시로 남음');

console.log('\n[E] 월간 목표는 공유, 화면 취향은 기기별');
await A.page.locator('.tab', { hasText: '설정' }).click();
await A.page.locator('.side-item', { hasText: '월간 목표' }).click();
await A.page.fill('#goal-in', '2500000');
await A.page.locator('#goal-save').click();
await A.page.waitForTimeout(300);
await sleep(3800);
ok(google.json('meta.json').shared.monthlyGoal === 2500000, '월간 목표가 meta.json에 올라감');
await Bm.syncNow(); await Bm.waitStatus('idle'); await Bm.page.waitForTimeout(300);
await Bm.page.locator('.tab', { hasText: '설정' }).click();
await Bm.page.locator('.menu-item', { hasText: '월간 목표' }).click();
ok((await Bm.page.inputValue('#goal-in')).replace(/,/g, '') === '2500000', '모바일에도 월간 목표 2,500,000원 반영');
await Bm.page.locator('.tab[data-tab="history"]').click();

console.log('\n[F] 로그인 만료 → 재연결 필요 → 입력은 계속 가능 → 재연결하면 밀린 변경 반영');
google.expired = true;
await A.page.evaluate(() => localStorage.removeItem('gagyeboo.token'));
await A.page.reload();
await A.page.waitForSelector('.account-chip'); await A.page.waitForTimeout(500); if (await A.page.locator('.modal.is-wide').count()) { await A.page.keyboard.press('Escape'); await A.page.waitForTimeout(200); }
await A.page.locator('.tab[data-tab="history"]').click();
ok((await A.status()) === 'reconnect', '토큰이 없으면 "재연결 필요"');
ok((await A.chip().innerText()).includes('재연결 필요'), '칩 문구');
await A.page.screenshot({ path: 'e2e/out/r3-desktop-reconnect.png' });
await A.addEntry('오프라인입력', 4321);
ok((await A.page.getByText('오프라인입력').count()) >= 1, '재연결 전에도 입력은 됨');
ok(!google.json('entries-2026.json').entries.some((e) => e.store === '오프라인입력'), '아직 드라이브에는 없음');
google.expired = false;
await A.openAccount();
ok((await A.page.getByRole('button', { name: '구글 다시 연결' }).count()) === 1, '"구글 다시 연결" 버튼');
await A.page.getByRole('button', { name: '구글 다시 연결' }).click();
await A.waitStatus('idle');
ok(google.json('entries-2026.json').entries.some((e) => e.store === '오프라인입력' && e.amount === 4321), '재연결하면 밀린 변경이 자동으로 올라감');
ok(await A.page.evaluate(() => window.__LAST_HINT) === 'alice@example.com', '재연결은 같은 계정을 힌트로 요청');
await A.closeModal();

console.log('\n[G] 다른 계정으로 재연결하면 거부');
await A.page.evaluate(() => localStorage.removeItem('gagyeboo.token'));
await A.page.reload(); await A.page.waitForSelector('.account-chip'); await A.page.waitForTimeout(500); if (await A.page.locator('.modal.is-wide').count()) { await A.page.keyboard.press('Escape'); await A.page.waitForTimeout(200); }
await A.page.evaluate(() => localStorage.setItem('fakeAccount', 'bob'));
await A.openAccount();
await A.page.getByRole('button', { name: '구글 다시 연결' }).click();
await A.page.waitForSelector('.toast');
ok((await A.page.locator('.toast').innerText()).includes('같은 계정으로 다시 시도'), '다른 계정이면 안내 토스트');
ok((await A.status()) === 'reconnect', '여전히 재연결 필요 상태');
await A.page.evaluate(() => localStorage.setItem('fakeAccount', 'alice'));
await A.page.getByRole('button', { name: '구글 다시 연결' }).click();
await A.waitStatus('idle');
await A.closeModal();

console.log('\n[H] 로그인 창을 닫으면 조용히 취소 / 드라이브 권한을 빼면 안내');
const H = await device('desktop', { width: 1366, height: 900 });
await H.page.evaluate(() => (window.__FAKE_MODE = 'closed'));
await H.signIn(); await H.page.waitForTimeout(300);
ok((await H.status()) === 'local' && (await H.page.locator('.toast').count()) === 0, '창 닫기 → 로컬 모드 유지, 오류 토스트 없음');
await H.page.evaluate(() => (window.__FAKE_MODE = 'noscope'));
await H.page.getByRole('button', { name: '구글 계정으로 로그인' }).click(); await H.page.waitForTimeout(400);
ok((await H.page.locator('.toast').innerText()).includes('드라이브 저장 권한'), '드라이브 권한을 빼면 안내');
ok((await H.status()) === 'local', '권한 없으면 로그인되지 않음');
await H.page.evaluate(() => (window.__FAKE_MODE = 'ok'));
await H.ctx.close();

console.log('\n[I] 양쪽에 내역이 있는 기기가 로그인하면 합치기 확인');
const I = await device('mobile', { width: 390, height: 844 });
await I.addEntry('내기기전용', 1111);
await I.addEntry('내기기전용2', 2222);
const remoteLive = google.json('entries-2026.json').entries.filter((e) => !e.deleted).length;
await I.signIn();
await I.page.waitForSelector('text=이 기기의 데이터와 합칩니다');
const msg = await I.page.locator('.modal', { hasText: '이 기기의 데이터와 합칩니다' }).innerText();
console.log('  confirm:', msg.replace(/\n/g, ' '));
ok(msg.includes('이 기기 2건') && msg.includes(`드라이브 ${remoteLive}건`) && msg.includes(`합계 ${remoteLive + 2}건`), '이 기기 N건 · 드라이브 M건 → 합계 K건');
await I.page.screenshot({ path: 'e2e/out/r3-mobile-merge-confirm.png' });
await I.page.getByRole('button', { name: '합치고 로그인' }).click();
await I.waitStatus('idle');
ok(google.json('entries-2026.json').entries.filter((e) => !e.deleted).length === remoteLive + 2, '합친 결과가 드라이브에도 반영');
ok((await I.page.getByText('동기화테스트마트').count()) === 0 && (await I.page.getByText('내기기전용').count()) >= 1, '기존 기록과 이 기기 기록이 모두 보임');

console.log('\n[J] 로그아웃: 데이터 남기기 / 지우기');
await A.openAccount();
await A.page.getByRole('button', { name: '로그아웃' }).click();
await A.page.waitForSelector('.modal >> text=로그아웃');
await A.page.screenshot({ path: 'e2e/out/r3-desktop-logout.png' });
await A.page.getByRole('button', { name: '데이터는 남기고 로그아웃' }).click();
await A.page.waitForTimeout(400);
ok((await A.status()) === 'local', '로그아웃 후 로컬 모드');
ok((await A.total()) !== '0', '이 기기의 데이터는 그대로');
ok(google.files().length === 2, '드라이브 데이터는 그대로');
ok(await A.page.evaluate(() => !localStorage.getItem('gagyeboo.account') && !localStorage.getItem('gagyeboo.token')), '계정·토큰 정보 삭제');
await A.page.reload(); await A.page.waitForSelector('.account-chip'); await A.page.waitForTimeout(500); if (await A.page.locator('.modal.is-wide').count()) { await A.page.keyboard.press('Escape'); await A.page.waitForTimeout(200); }
ok((await A.status()) === 'local', '새로고침해도 로컬 모드');

await I.openAccount();
await I.page.getByRole('button', { name: '로그아웃' }).click();
await I.page.getByRole('button', { name: '이 기기 데이터도 삭제' }).click();
await I.page.waitForTimeout(500);
ok((await I.status()) === 'local' && (await I.page.locator('.empty').count()) === 1, '데이터 삭제 로그아웃 → 빈 상태');
ok(google.json('entries-2026.json').entries.filter((e) => !e.deleted).length === remoteLive + 2, '그래도 드라이브 데이터는 그대로');
// 다시 로그인하면 돌아온다
await I.signIn(); await I.waitStatus('idle'); await I.page.waitForTimeout(300);
ok((await I.page.locator('.empty').count()) === 0, '다시 로그인하면 데이터가 돌아옴');

console.log('\n[J2] 모바일 로그아웃 대화상자 폭 + 드라이브 데이터 삭제');
{
  const dlg = async (d) => {
    await d.openAccount();
    await d.page.getByRole('button', { name: '로그아웃' }).click();
    await d.page.waitForSelector('.modal[aria-label="로그아웃"]');
  };
  await dlg(I);
  const fits = await I.page.evaluate(() => {
    const m = document.querySelector('.modal[aria-label="로그아웃"]');
    const r = m.getBoundingClientRect();
    const over = [...m.querySelectorAll('*')].filter((el) => el.getBoundingClientRect().right > r.right + 0.5 || el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX === 'visible' && el.getBoundingClientRect().right > innerWidth);
    return { w: r.width, vw: innerWidth, over: over.map((e) => e.tagName + '.' + e.className).slice(0, 5) };
  });
  ok(fits.w <= fits.vw && fits.over.length === 0, '모바일 로그아웃 창이 화면 안에 들어옴 ' + JSON.stringify(fits));
  await I.page.screenshot({ path: 'e2e/out/r3-mobile-logout.png' });
  await I.page.locator('.logout-erase input').check();
  await I.page.screenshot({ path: 'e2e/out/r3-mobile-logout-erase.png' });
  // 확인 창에서 취소하면 아무것도 지워지지 않는다
  await I.page.getByRole('button', { name: '드라이브와 이 기기 데이터 모두 삭제' }).click();
  await I.page.waitForSelector('.modal[aria-label="드라이브의 데이터를 지웁니다"]');
  await I.page.screenshot({ path: 'e2e/out/r3-mobile-erase-confirm.png' });
  await I.page.getByRole('button', { name: '취소' }).last().click();
  await I.page.waitForTimeout(300);
  ok(google.files().length === 2 && (await I.status()) !== 'local', '확인 창에서 취소하면 그대로');
  // 삭제 진행: 드라이브가 비고, 이 기기 데이터도 지워진다
  await I.page.getByRole('button', { name: '드라이브와 이 기기 데이터 모두 삭제' }).click();
  await I.page.getByRole('button', { name: '드라이브 데이터 삭제', exact: true }).click();
  await I.page.waitForTimeout(800);
  ok(google.files().length === 0, '드라이브의 앱 데이터가 모두 삭제됨');
  ok((await I.status()) === 'local' && (await I.page.locator('.empty').count()) === 1, '로그아웃되고 이 기기도 비어 있음');
  // 다른 기기(A)가 다시 로그인하면 빈 드라이브에 자기 데이터를 올린다 → 완전히 없애려면 그 기기에서도 지워야 함
  await A.signIn(); await A.waitStatus('idle');
  ok(google.files().length === 2, '다른 기기가 로그인하면 자기 데이터를 다시 올림(안내문대로)');
  // 만료된 상태에서도: 재허용 후 삭제
  await A.page.evaluate(() => localStorage.removeItem('gagyeboo.token'));
  await dlg(A);
  await A.page.locator('.logout-erase input').check();
  await A.page.getByRole('button', { name: '드라이브 데이터 삭제 후 로그아웃' }).click();
  await A.page.waitForSelector('.modal[aria-label="드라이브의 데이터를 지웁니다"]');
  await A.page.getByRole('button', { name: '드라이브 데이터 삭제', exact: true }).click();
  await A.page.waitForTimeout(800);
  ok(google.files().length === 0, '로그인이 만료돼 있어도 재허용 후 삭제됨');
  ok((await A.status()) === 'local' && (await A.total()) !== '0', '이 기기 데이터는 남김');
  // 이후 다시 로그인하면 이 기기 데이터가 드라이브로 올라간다
  await A.signIn(); await A.waitStatus('idle');
  ok(google.files().length === 2, '남겨 둔 기기 데이터는 다시 로그인하면 올라감');
}

console.log('\n[K] 오프라인에서 입력 → 연결되면 자동 반영');
google.offline = true;
await Bm.addEntry('지하철입력', 1500);
await Bm.syncNow(); await Bm.page.waitForTimeout(500);
ok((await Bm.status()) === 'offline', '오프라인 상태 표시');
google.offline = false;
await Bm.page.evaluate(() => window.dispatchEvent(new Event('online')));
await Bm.waitStatus('idle', 10000);
ok(google.json('entries-2026.json').entries.some((e) => e.store === '지하철입력'), '연결이 돌아오면 자동 동기화');

console.log('\n[L] 오류');
ok([A, Bm, I].every((d) => d.errs.length === 0), '콘솔 오류 없음 ' + [A, Bm, I].flatMap((d) => d.errs).join(' | '));

await browser.close();
console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
