// 계정 공유 — 손님 쪽: 초대 수락, 읽기 전용, 제안 보내기, 새로 받기, 연결 끊김, 정리/내 가계부로 전환
import { chromium } from 'playwright-core';
import { FakeGoogle } from './fakeGoogle.mjs';
const URL = 'http://localhost:4173/gagyeboo/';
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const google = new FakeGoogle();
let failed = 0;
const ok = (c, m) => { if (!c) { failed++; console.log('  FAIL:', m); } else console.log('  ok:', m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CID = '1234567890-test.apps.googleusercontent.com';

async function device(name, vp, who) {
  const ctx = await browser.newContext({ viewport: vp, locale: 'ko-KR', timezoneId: 'Asia/Seoul', acceptDownloads: true });
  await google.install(ctx);
  await ctx.addInitScript(([cid, w]) => {
    if (!localStorage.getItem('gagyeboo.clientId')) localStorage.setItem('gagyeboo.clientId', cid);
    localStorage.setItem('gagyeboo.pickerKey', 'key');
    localStorage.setItem('gagyeboo.pickerApp', '123');
    localStorage.setItem('fakeAccount', w);
  }, [CID, who]);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errs.push(m.text()));
  await page.goto(URL);
  await page.waitForSelector('.empty, .history');
  const mobile = vp.width <= 640;
  const d = { name, ctx, page, errs, mobile };
  d.openSettingsPage = async (label) => {
    await page.locator('.tab[data-tab="settings"]').click();
    await page.locator(mobile ? '.menu-item' : '.side-item', { hasText: label }).click();
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
  d.confirm = async () => { await page.locator('.modal .btn[data-autofocus]').click(); };
  d.text = () => page.locator('body').innerText();
  return d;
}
const g = (name) => [...google.gfiles.values()].find((f) => f.name === name && !f.trashed);
const proposals = () => [...google.gfiles.values()].filter((f) => f.name.startsWith('proposal-'));


let seq = 100;
const inject = (owner, payload, name) => {
  const id = 'inj' + ++seq;
  const content = typeof payload === 'string' ? payload : JSON.stringify(payload);
  google.gfiles.set(id, { id, name: name || `proposal-${id}xxxxxxxx.json`, mimeType: 'application/json', parents: [g('inbox').id], owner, content, perms: [], trashed: false, writes: 1 });
  return id;
};
const good = (over) => ({ app: 'gagyeboo-proposal', v: 1, id: 'src-' + ++seq, createdAt: 1, from: 'x', date: '2026-11-09', store: '주입상점', memo: '', category: null, amount: 1500, user: null, payMethod: null, payDetail: null, ...over });
/** 입력 대기 창을 열어 처음부터 끝까지 돌며 decide(카드 글자)가 돌려준 대로 고르고 적용한다 */
const walk = async (d, decide, apply = true) => {
  if (!(await d.page.locator('.queue-window').count())) {
    await d.page.locator('.queue-btn').click();
    await d.page.waitForSelector('.queue-window');
  }
  while (await d.page.locator('.q-prev:not([disabled])').count()) await d.page.locator('.q-prev').click();
  const texts = [];
  for (;;) {
    const c = await d.page.locator('.q-card').innerText();
    texts.push(c);
    const a = decide(c);
    if (a) await d.page.locator(a === 'enter' ? '.q-enter' : '.q-skip').click();
    if (!(await d.page.locator('.q-next:not([disabled])').count())) break;
    await d.page.locator('.q-next').click();
  }
  if (apply) await d.page.locator('.q-apply').click();
  return texts;
};
const isProp = (c) => c.includes('손님 제안');
const qCount = (d) => d.page.evaluate(() => { const b = document.querySelector('.queue-btn'); return b ? Number(b.textContent.match(/\d+/)?.[0]) : 0; });

console.log('\n[A] 주인: 공유 켜기·손님 초대');
const A = await device('owner', { width: 1366, height: 900 }, 'alice');
await A.page.getByText('가상 데이터로 둘러보기').first().click();
await A.page.waitForSelector('.ledger, .cards');
await A.page.waitForTimeout(400);
if (await A.page.locator('.modal.is-wide').count()) { await A.page.keyboard.press('Escape'); await A.page.waitForTimeout(200); }
await A.page.locator('.account-chip').click();
await A.page.getByRole('button', { name: '구글 계정으로 로그인' }).click();
await A.page.waitForSelector('.account-chip.is-idle', { timeout: 8000 });
await A.openSettingsPage('계정 공유');
await A.page.getByRole('button', { name: '공유 켜기' }).click();
await A.page.waitForSelector('#share-email');
await A.page.fill('#share-email', 'bob@example.com');
await A.page.getByRole('button', { name: '초대', exact: true }).click();
await A.page.waitForSelector('.share-guests');
await A.page.getByRole('button', { name: '지금 공유 내용 갱신' }).click();
await A.page.waitForTimeout(500);
const mirrorId = g('mirror.json').id;
ok((await A.text()).includes('손님 제안'), '공유 설정에 「손님 제안」 영역');

console.log('\n[B] 손님: 열고 제안 1건 보내기');
const B = await device('guest', { width: 1366, height: 900 }, 'bob');
await B.openSettingsPage('계정 공유');
await B.page.evaluate((id) => { window.__PICK = { id, name: 'mirror.json' }; }, mirrorId);
await B.page.getByRole('button', { name: '공유받은 가계부 열기' }).click();
await B.page.waitForSelector('.modal .btn[data-autofocus]');
await Promise.all([B.page.waitForNavigation(), B.confirm()]);
await B.page.waitForSelector('.guest-banner');
await B.page.locator('.tab[data-tab="history"]').click();
await B.page.locator('.add-btn').click();
await B.page.waitForSelector('.sheet');
await B.page.fill('#f-store', '손님제안상점');
await B.page.fill('#f-memo', '손님 명세');
await B.page.fill('#f-amount', '3300');
await B.page.locator('.sheet .chips .chip').nth(1).click();
await B.page.locator('.sheet-foot .btn.primary').click();
await B.page.waitForSelector('.toast');
await B.page.waitForSelector('.sheet', { state: 'detached' });
const real = [...google.gfiles.values()].find((f) => f.name.startsWith('proposal-') && f.owner === 'bob@example.com');
ok(!!real, '손님의 제안 파일이 inbox에 있음');

console.log('\n[C] 악성·이상한 파일 주입');
inject('mallory@example.com', good({ store: '초대안한계정' }));          // 손님이 아닌 계정
inject('bob@example.com', { app: 'x' });                                  // 형식 오류
inject('bob@example.com', good({ amount: -5 }));                          // 음수 금액
inject('bob@example.com', good({ date: '2026-13-45' }));                  // 날짜 오류
inject('bob@example.com', 'not json at all');                             // JSON 아님
inject('bob@example.com', good({ store: '목록밖', category: 'nope', user: 'nope', payMethod: 'nope', payDetail: 'nope', amount: 4400 }));
inject('bob@example.com', good({ store: 'x'.repeat(500), memo: 'y'.repeat(500) }));  // 길이 초과는 잘라서 받음
inject('bob@example.com', good({ store: '이름이상' }), 'proposal-ab.json');          // 파일 이름 형식 오류

console.log('\n[D] 주인이 확인하면 입력 대기에 들어온다');
await A.openSettingsPage('계정 공유');
const base = await qCount(A);
await A.page.getByRole('button', { name: '지금 제안 확인' }).click();
await A.page.waitForFunction(() => document.querySelector('.toast')?.textContent.includes('손님 제안'), null, { timeout: 8000 });
const toastTxt = await A.page.locator('.toast').innerText();
ok(toastTxt.includes('3건'), '토스트: ' + toastTxt);
ok((await qCount(A)) === base + 3, `입력 대기에 제안 3건 추가(정상 1 + 목록밖 1 + 긴 글 1): ${base} → ${await qCount(A)}`);
ok((await A.text()).includes('건너뛴 파일'), '건너뛴 파일 수 표시');
const props = await A.page.evaluate(async () => {
  const dbs = await indexedDB.databases();
  return dbs.map((d) => d.name);
});
await A.page.getByRole('button', { name: '지금 제안 확인' }).click();
await A.page.waitForFunction(() => document.querySelector('.toast')?.textContent.includes('새 제안이 없습니다'), null, { timeout: 8000 });
ok((await qCount(A)) === base + 3, '다시 확인해도 중복으로 들어오지 않음');
const cards = (await walk(A, () => null, false)).filter(isProp);
ok(cards.length === 3, '제안 카드 3장');
const real_ = cards.find((c) => c.includes('손님제안상점'));
ok(real_ && real_.includes('손님 제안') && real_.includes('밥'), '제안자(구글 이름)와 「손님 제안」 표시');
ok(real_ && real_.includes('3,300'), '금액 3,300원');
const outside = cards.find((c) => c.includes('목록밖'));
ok(outside && outside.includes('미분류') && outside.includes('미지정'), '목록에 없는 분류·사용자·지불수단은 비움');
ok(!cards.some((c) => c.includes('초대안한계정') || c.includes('이름이상')), '초대하지 않은 계정·이름 오류 파일은 들어오지 않음');
const longCard = cards.find((c) => c.includes('xxxxxxxx'));
ok(longCard && !longCard.includes('x'.repeat(61)), '긴 글은 잘라서 받음');

console.log('\n[E] 입력 / 입력하지 않음 → 처리 기록');
await walk(A, (c) => (isProp(c) ? (c.includes('손님제안상점') ? 'enter' : 'skip') : null), false);
await A.page.locator('.q-apply').click();
await A.page.waitForFunction(() => document.querySelector('.toast')?.textContent.includes('적용했습니다'));
ok((await qCount(A)) === base, '제안은 모두 처리되어 입력 대기에서 사라짐');
await A.page.locator('.tab[data-tab="history"]').click();
await A.page.waitForTimeout(300);
ok((await A.page.locator('.history').innerText()).includes('손님제안상점'), '내역에 입력됨');
// 실행 취소 → 3건 복귀
await A.page.locator('.toast-undo').click();
await A.page.waitForTimeout(400);
ok((await qCount(A)) === base + 3, '실행 취소하면 제안 3건이 입력 대기로 돌아옴');
await walk(A, (c) => (isProp(c) ? (c.includes('손님제안상점') ? 'enter' : 'skip') : null));
await A.page.waitForFunction(() => document.querySelector('.toast')?.textContent.includes('적용했습니다'));
await A.openSettingsPage('계정 공유');
await A.page.getByRole('button', { name: '지금 제안 확인' }).click();
await A.page.waitForFunction(() => document.querySelector('.toast')?.textContent.includes('새 제안이 없습니다'), null, { timeout: 8000 });
ok((await qCount(A)) === base, '처리한 제안은 다시 확인해도 돌아오지 않음');

console.log('\n[F] 다른 기기(주인 2번째 기기): 이미 처리한 제안은 다시 받지 않는다');
await sleep(4500);
await A.page.locator('.account-chip').click();
await A.page.waitForSelector('.modal');
await A.page.getByRole('button', { name: /지금 동기화/ }).click().catch(() => {});
await A.page.keyboard.press('Escape');
await sleep(1500);
const C = await device('owner2', { width: 1366, height: 900 }, 'alice');
await C.page.locator('.account-chip').click();
await C.page.getByRole('button', { name: '구글 계정으로 로그인' }).click();
await C.page.waitForSelector('.account-chip.is-idle, .account-chip.is-reconnect', { timeout: 8000 });
await C.page.getByRole('button', { name: '나중에' }).click({ timeout: 10000 }); // 공유 권한이 없는 기기에서 묻는 창
await C.page.waitForTimeout(1500);
await C.openSettingsPage('계정 공유');
await C.page.getByRole('button', { name: '구글 다시 연결' }).click();
await C.page.waitForFunction(() => !document.body.innerText.includes('구글 다시 연결'), null, { timeout: 8000 });
await C.page.waitForTimeout(1500);
ok((await qCount(C)) === base, `두 번째 기기에도 이미 처리한 제안이 다시 들어오지 않음 (${await qCount(C)} / 기준 ${base})`);
await C.page.locator('.tab[data-tab="history"]').click();
await C.page.waitForTimeout(300);
ok((await C.page.locator('.history').innerText()).includes('손님제안상점'), '입력한 내역은 동기화되어 보임');

console.log('\n[G] 해제된 손님의 새 파일은 무시');
await A.openSettingsPage('계정 공유');
await A.page.getByRole('button', { name: '해제', exact: true }).click();
await A.page.locator('.modal .btn.danger').last().click();
await A.page.waitForFunction(() => !document.querySelector('.share-guests'), null, { timeout: 5000 });
inject('bob@example.com', good({ store: '해제뒤제안' }));
await A.page.getByRole('button', { name: '지금 제안 확인' }).click();
await A.page.waitForTimeout(1200);
ok((await qCount(A)) === base, '해제된 손님의 제안은 들어오지 않음');

ok(A.errs.length === 0, '콘솔 오류 없음(주인) ' + A.errs.join(' | '));
ok(B.errs.length === 0, '콘솔 오류 없음(손님) ' + B.errs.join(' | '));
ok(C.errs.length === 0, '콘솔 오류 없음(주인2) ' + C.errs.join(' | '));
await browser.close();
console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
