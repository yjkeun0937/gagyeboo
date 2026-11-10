// 주인 쪽 공유 내용(mirror.json)이 손님에게 최신으로 유지되는지:
// 공유 권한 없는 두 번째 기기의 안내·복구, 올리기 전에 앱을 닫은 경우의 재시도
import { chromium } from 'playwright-core';
import { FakeGoogle } from './fakeGoogle.mjs';
const URL = 'http://localhost:4173/gagyeboo/';
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const google = new FakeGoogle();
let failed = 0;
const ok = (c, m) => { if (!c) { failed++; console.log('  FAIL:', m); } else console.log('  ok:', m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CID = '1234567890-test.apps.googleusercontent.com';
const FULL = 'https://www.googleapis.com/auth/drive';

async function device(name, vp) {
  const ctx = await browser.newContext({ viewport: vp, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  await google.install(ctx);
  await ctx.addInitScript((cid) => { if (!localStorage.getItem('gagyeboo.clientId')) localStorage.setItem('gagyeboo.clientId', cid); }, CID);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errs.push(m.text()));
  await page.goto(URL);
  await page.waitForSelector('.empty, .history');
  const mobile = vp.width <= 640;
  const d = { name, ctx, page, errs, mobile };
  d.scope = () => page.evaluate(() => window.__LAST_SCOPE);
  d.signIn = async () => {
    await page.locator('.account-chip').click();
    await page.waitForSelector('.modal');
    await page.getByRole('button', { name: '구글 계정으로 로그인' }).click();
    await page.waitForSelector('.account-chip.is-idle, .account-chip.is-reconnect', { timeout: 8000 });
  };
  d.addEntry = async (store, amount) => {
    await page.locator('.tab[data-tab="history"]').click();
    await (mobile ? page.locator('.fab:not(.queue-fab)') : page.locator('.add-btn')).click();
    await page.waitForSelector('.sheet');
    await page.fill('#f-store', store);
    await page.fill('#f-amount', String(amount));
    await page.locator('.sheet-foot .btn.primary').click();
    await page.waitForSelector('.sheet', { state: 'detached' });
  };
  return d;
}
const g = (name) => [...google.gfiles.values()].find((f) => f.name === name && !f.trashed);
const inMirror = (store) => JSON.parse(g('mirror.json').content).backup.entries.some((e) => e.store === store);
async function waitMirror(store, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms && !inMirror(store)) await sleep(500);
  return inMirror(store);
}

console.log('\n[준비] 주인 기기 A: 공유 켜고 손님 초대');
const A = await device('desktop', { width: 1366, height: 900 });
await A.page.getByText('가상 데이터로 둘러보기').first().click();
await A.page.waitForSelector('.ledger, .cards');
await A.page.waitForTimeout(400);
if (await A.page.locator('.modal.is-wide').count()) { await A.page.keyboard.press('Escape'); await A.page.waitForTimeout(200); }
await A.signIn();
await A.page.locator('.tab[data-tab="settings"]').click();
await A.page.locator('.side-item', { hasText: '계정 공유' }).click();
await A.page.getByRole('button', { name: '공유 켜기' }).click();
await A.page.waitForSelector('.share-guests, .share-invite');
await A.page.fill('#share-email', 'bob@example.com');
await A.page.getByRole('button', { name: '초대', exact: true }).click();
await A.page.waitForFunction(() => document.querySelector('.share-guests'));
ok(!!g('mirror.json'), '미러 생성');

console.log('\n[1] 올리기 전에 앱을 닫아도, 다음에 열 때 공유 내용을 최신으로 올린다');
await A.addEntry('닫기전상점', 4321);
await A.page.reload(); // 20초 안에 닫은 것과 같다: 올리기 예약이 사라진다
await A.page.waitForSelector('.tab[data-tab="history"]');
ok(await waitMirror('닫기전상점', 20000), '다시 열면 바뀐 내용이 미러에 올라감');

console.log('\n[2] 공유 권한이 없는 두 번째 주인 기기: 주인 화면에서 바로 알려 주고 복구된다');
const B = await device('mobile', { width: 390, height: 844 });
await B.signIn();
await B.page.waitForSelector('.confirm-msg', { timeout: 8000 });
ok((await B.page.locator('.confirm-msg').innerText()).includes('손님과 공유 중'), '공유 권한이 없으면 앱에서 바로 물어봄');
await B.page.getByRole('button', { name: '나중에' }).click();
await B.page.waitForSelector('.account-chip.is-reconnect', { timeout: 15000 }).catch(() => {});
ok((await B.page.locator('.account-chip').getAttribute('class')).includes('is-reconnect'), '계정 칩이 공유 재연결 필요 상태로 바뀜 (설정 화면을 열지 않아도)');
ok(((await B.page.locator('.account-chip').getAttribute('aria-label')) || '').includes('공유 재연결 필요'), '칩 설명에 「공유 재연결 필요」');
await B.addEntry('둘째기기상점', 5555);
await sleep(1500);
ok(!inMirror('둘째기기상점'), '권한이 없는 동안에는 올리지 못함(손님은 이전 내용)');
await B.page.locator('.account-chip').click();
await B.page.waitForSelector('.modal .notice');
ok((await B.page.locator('.modal .notice').innerText()).includes('손님에게 최신 내용을 올리지 못하고'), '계정 창에 안내');
await B.page.screenshot({ path: 'e2e/out/mirror-blocked-mobile.png' });
await B.page.getByRole('button', { name: '구글 다시 연결' }).click();
await B.page.waitForFunction(() => !document.querySelector('.account-chip.is-reconnect'), null, { timeout: 10000 });
ok((await B.scope()).split(' ').includes(FULL), '다시 연결할 때 드라이브 전체 범위 요청');
ok(await waitMirror('둘째기기상점', 15000), '다시 연결하면 쌓였던 변경이 별도 입력 없이 미러에 올라감');
ok(inMirror('닫기전상점'), '다른 기기가 올린 내용도 함께 들어 있음');

console.log('\n[2b] 같은 상황에서 묻는 창의 「구글 다시 연결」로 바로 허용');
const C = await device('desktop2', { width: 1280, height: 800 });
await C.signIn();
await C.page.waitForSelector('.confirm-msg', { timeout: 8000 });
await C.page.getByRole('button', { name: '구글 다시 연결' }).click();
await C.page.waitForFunction(() => !document.querySelector('.account-chip.is-reconnect') && !document.querySelector('.confirm-msg'), null, { timeout: 10000 });
ok((await C.scope()).split(' ').includes(FULL), '묻는 창에서 허용하면 공유 권한이 들어감');
await C.addEntry('셋째기기상점', 3333);
ok(await waitMirror('셋째기기상점', 30000), '셋째 기기의 변경도 손님 미러에 올라감');

console.log('\n[3] 이미 최신이면 불필요하게 다시 올리지 않는다');
// 다른 기기의 변경을 받은 기기는 합쳐진 내용을 한 번씩 올릴 수 있다 → 먼저 그 과정을 끝낸다
await B.page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
await A.page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
await sleep(12000);
const w = g('mirror.json').writes;
// 그 뒤로는 바뀐 것이 없으므로 몇 번을 확인해도 쓰지 않는다
for (let i = 0; i < 2; i++) {
  await sleep(21000); // 다시 보기 사이의 최소 간격(20초)
  await B.page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await A.page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await sleep(7000);
}
ok(g('mirror.json').writes === w, `쓰기 횟수 변화 없음 (${w} → ${g('mirror.json').writes})`);

ok(A.errs.length === 0, '콘솔 오류 없음(A) ' + A.errs.join(' | '));
ok(B.errs.length === 0, '콘솔 오류 없음(B) ' + B.errs.join(' | '));
ok(C.errs.length === 0, '콘솔 오류 없음(C) ' + C.errs.join(' | '));
await browser.close();
console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
