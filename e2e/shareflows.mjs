// 계정 공유(주인 쪽): 켜기·초대·미러 게시·자동 갱신·다른 기기 복원·해제·끄기
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
  d.scopeReq = () => page.evaluate(() => ({ scope: window.__LAST_SCOPE, include: window.__LAST_INCLUDE, prompt: window.__LAST_PROMPT }));
  d.signIn = async () => {
    await page.locator('.account-chip').click();
    await page.waitForSelector('.modal');
    await page.getByRole('button', { name: '구글 계정으로 로그인' }).click();
    await page.waitForSelector('.account-chip.is-idle, .account-chip.is-reconnect', { timeout: 8000 });
  };
  d.openShare = async () => {
    await page.locator('.tab[data-tab="settings"]').click();
    await page.locator(mobile ? '.menu-item' : '.side-item', { hasText: '계정 공유' }).click();
    await page.waitForSelector('.share-page');
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
const mirror = () => JSON.parse(g('mirror.json').content);

console.log('\n[A] 공유를 쓰기 전에는 넓은 권한을 요청하지 않는다');
const A = await device('desktop', { width: 1366, height: 900 });
await A.page.getByText('가상 데이터로 둘러보기').first().click();
await A.page.waitForSelector('.ledger, .cards');
await A.page.waitForTimeout(400);
if (await A.page.locator('.modal.is-wide').count()) { await A.page.keyboard.press('Escape'); await A.page.waitForTimeout(200); }
await A.signIn();
let sr = await A.scopeReq();
ok(!sr.scope.split(' ').includes(FULL), `일반 로그인은 드라이브 전체 범위 없음 (${sr.scope})`);
ok(sr.include === false, '이전에 허용한 범위를 합치지 않음(include_granted_scopes=false)');
await A.openShare();
ok((await A.page.locator('.share-page').innerText()).includes('읽기만'), '공유 설명 표시');
ok((await A.page.getByRole('button', { name: '공유 켜기' }).count()) === 1, '「공유 켜기」 버튼');
await A.page.screenshot({ path: 'e2e/out/share-off-desktop.png' });

console.log('\n[B] 권한이 허용되지 않으면 켜지지 않고 폴더도 만들지 않는다');
await A.page.evaluate(() => { window.__FAKE_NOFULL = true; });
await A.page.getByRole('button', { name: '공유 켜기' }).click();
await A.page.waitForSelector('.form-error');
ok((await A.page.locator('.form-error').innerText()).includes('드라이브 전체 접근 권한'), '권한 거부 안내: ' + (await A.page.locator('.form-error').innerText()));
ok(google.gfiles.size === 0, '폴더를 만들지 않음');
ok((await A.page.evaluate(() => localStorage.getItem('gagyeboo.share'))) === null, '공유 사용 표시가 남지 않음');
await A.page.evaluate(() => { window.__FAKE_NOFULL = false; });

console.log('\n[C] 공유 켜기');
await A.page.getByRole('button', { name: '공유 켜기' }).click();
await A.page.waitForSelector('.share-guests, .share-invite');
sr = await A.scopeReq();
ok(sr.scope.split(' ').includes(FULL), '공유를 켤 때 드라이브 전체 범위 요청');
ok(sr.prompt === 'consent', '동의 화면을 다시 띄움');
ok(g('가계부 공유') && g('data') && g('inbox') && g('mirror.json'), '공유 폴더·data·inbox·mirror.json 생성');
ok(g('data').parents[0] === g('가계부 공유').id && g('inbox').parents[0] === g('가계부 공유').id, 'data·inbox가 공유 폴더 안에 있음');
ok(g('mirror.json').parents[0] === g('data').id, 'mirror.json이 data 안에 있음');
ok(google.files().some((f) => f.name === 'share.json'), '앱 전용 폴더에 share.json 저장');
const m0 = mirror();
ok(m0.app === 'gagyeboo-mirror' && m0.inboxId === g('inbox').id, '미러에 inbox ID 포함');
ok(m0.backup.entries.length > 50 && m0.backup.entries.every((e) => !e.deleted), `미러에 내역 ${m0.backup.entries.length}건(삭제 표시 제외)`);
ok(m0.owner.email === 'alice@example.com', '미러에 주인 정보');
ok((await A.page.locator('.share-page').innerText()).includes('손님 (0/5)'), '손님 0/5');
ok((await A.page.evaluate(() => localStorage.getItem('gagyeboo.share'))) === '1', '공유 사용 표시 저장');
await A.page.screenshot({ path: 'e2e/out/share-on-desktop.png' });

console.log('\n[D] 손님 초대');
await A.page.fill('#share-email', 'not-an-email');
await A.page.getByRole('button', { name: '초대', exact: true }).click();
ok((await A.page.locator('.form-error').innerText()).includes('이메일 주소를 확인'), '잘못된 형식');
await A.page.fill('#share-email', 'alice@example.com');
await A.page.getByRole('button', { name: '초대', exact: true }).click();
ok((await A.page.locator('.form-error').innerText()).includes('내 계정'), '내 계정은 초대 불가');
await A.page.fill('#share-email', 'someone@nogoogle.org');
await A.page.getByRole('button', { name: '초대', exact: true }).click();
await A.page.waitForFunction(() => document.querySelector('.form-error')?.textContent.includes('구글 계정이 아니거나'));
ok(g('가계부 공유').perms.length === 0, '실패하면 권한이 남지 않음');
const writes0 = g('mirror.json').writes;
await A.page.fill('#share-email', 'Bob@Example.com');
await A.page.getByRole('button', { name: '초대', exact: true }).click();
await A.page.waitForFunction(() => document.querySelector('.share-guests'));
ok(g('가계부 공유').perms.length === 1 && g('가계부 공유').perms[0].role === 'reader' && g('가계부 공유').perms[0].emailAddress === 'bob@example.com', '공유 폴더에 읽기 권한(소문자로 정리)');
ok(g('inbox').perms.length === 1 && g('inbox').perms[0].role === 'writer', 'inbox에 쓰기 권한');
ok((await A.page.locator('.share-guests').innerText()).includes('bob@example.com'), '목록에 표시');
for (let i = 0; i < 20 && g('mirror.json').writes <= writes0; i++) await sleep(200);
ok(g('mirror.json').writes > writes0, '초대하면 미러를 다시 올림');
await A.page.fill('#share-email', 'bob@example.com');
await A.page.getByRole('button', { name: '초대', exact: true }).click();
ok((await A.page.locator('.form-error').innerText()).includes('이미 초대'), '중복 초대 안내');

console.log('\n[E] 바뀐 내용 자동 반영(잠시 뒤)');
await A.addEntry('공유확인상점', 7777);
await A.openShare();
const w1 = g('mirror.json').writes;
await A.page.waitForFunction(() => document.querySelector('.share-page .sync-line.is-idle'), null, { timeout: 5000 }).catch(() => {});
await sleep(1000);
const t0 = Date.now();
while (Date.now() - t0 < 32000 && !mirror().backup.entries.some((e) => e.store === '공유확인상점')) await sleep(1000);
ok(mirror().backup.entries.some((e) => e.store === '공유확인상점'), `새 내역이 미러에 반영됨 (${Math.round((Date.now() - t0) / 1000)}초 뒤)`);
ok(g('mirror.json').writes > w1, '미러 갱신');
const w2 = g('mirror.json').writes;
await A.page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
await sleep(300);
await A.page.getByRole('button', { name: '지금 공유 내용 갱신' }).click();
await A.page.waitForTimeout(500);
ok(g('mirror.json').writes === w2 + 1, '수동 갱신은 내용이 같아도 올림');

console.log('\n[F] 다른 기기(모바일): 로그인하면 공유 설정을 이어받고, 다시 연결하면 관리할 수 있다');
const B = await device('mobile', { width: 390, height: 844 });
await B.signIn();
await B.page.getByRole('button', { name: '나중에' }).click({ timeout: 10000 }); // 공유 권한이 없는 기기에서 묻는 창
await B.page.waitForTimeout(300);
await B.openShare();
ok((await B.page.locator('.share-page').innerText()).includes('bob@example.com'), '손님 목록을 이어받음');
ok((await B.page.locator('.share-page').innerText()).includes('다시 연결 필요'), '이 기기는 공유 권한이 없어 다시 연결 필요');
await B.page.getByRole('button', { name: '구글 다시 연결' }).click();
await B.page.waitForFunction(() => document.querySelector('.share-page .sync-line.is-idle') || !document.body.innerText.includes('구글 다시 연결'), null, { timeout: 8000 });
sr = await B.scopeReq();
ok(sr.scope.split(' ').includes(FULL), '다시 연결할 때 드라이브 전체 범위 요청');
await B.page.screenshot({ path: 'e2e/out/share-on-mobile.png' });

console.log('\n[G] 손님 해제');
await A.page.reload();
await A.page.waitForSelector('.tab[data-tab="settings"]');
await A.page.waitForTimeout(500);
await A.openShare();
ok((await A.page.locator('.share-guests').count()) === 1, '새로고침 뒤에도 손님이 유지됨');
await A.page.getByRole('button', { name: '해제', exact: true }).click();
await A.page.locator('.confirm-dialog .btn.danger, .modal .btn.danger').last().click();
await A.page.waitForFunction(() => !document.querySelector('.share-guests'), null, { timeout: 5000 });
ok(g('가계부 공유').perms.length === 0 && g('inbox').perms.length === 0, '두 폴더의 권한이 모두 해제됨');

console.log('\n[H] 공유 끄기');
await A.page.getByRole('button', { name: '공유 끄기', exact: true }).last().click();
await A.page.locator('.confirm-dialog .btn.danger, .modal .btn.danger').last().click();
await A.page.waitForSelector('.share-page .btn.primary:has-text("공유 켜기")', { timeout: 5000 });
ok([...google.gfiles.values()].find((f) => f.name === '가계부 공유').trashed, '공유 폴더가 휴지통으로 이동');
ok(!google.files().some((f) => f.name === 'share.json'), 'share.json 삭제');
ok((await A.page.evaluate(() => localStorage.getItem('gagyeboo.share'))) === null, '공유 사용 표시 해제');

ok(A.errs.length === 0, '콘솔 오류 없음(데스크탑) ' + A.errs.join(' | '));
ok(B.errs.length === 0, '콘솔 오류 없음(모바일) ' + B.errs.join(' | '));
await browser.close();
console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
