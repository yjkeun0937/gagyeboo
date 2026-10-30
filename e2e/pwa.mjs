import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

/**
 * PWA: 설치 정보, 오프라인 실행, 새 버전 안내·반영, 데이터 유지.
 * dist를 직접 서빙하는 작은 서버(포트 4180)를 쓰므로, 시험 중에 다시 빌드해도 바로 반영된다.
 */
const PORT = 4180;
const BASE = '/gagyeboo/';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.woff': 'font/woff' };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (!u.pathname.startsWith(BASE)) { res.writeHead(404); res.end(); return; }
  let rel = decodeURIComponent(u.pathname.slice(BASE.length)) || 'index.html';
  const file = path.join('dist', rel);
  if (!file.startsWith('dist') || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'max-age=600' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(PORT, r));
const APP = `http://localhost:${PORT}${BASE}`;

const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
let failed = 0;
const ok = (c, m) => { if (!c) { failed++; console.log('  FAIL:', m); } else console.log('  ok:', m); };
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
const page = await ctx.newPage();
const errs = [];
const failedReqs = [];
page.on('requestfailed', (r) => failedReqs.push(r.url()));
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));

// 설치 정보
const mf = await (await ctx.request.get(`${APP}manifest.webmanifest`)).json();
ok(mf.name === '가계부' && mf.display === 'standalone' && mf.icons.length >= 3, '설치 정보(manifest) 이름·표시 방식·아이콘');
ok(mf.icons.some((i) => i.purpose === 'maskable'), '마스크용 아이콘 포함');
for (const i of mf.icons) {
  const r = await ctx.request.get(new URL(i.src, `${APP}manifest.webmanifest`).href);
  ok(r.ok(), `아이콘 ${i.src} 받아짐`);
}

// 첫 방문 → 서비스 워커 설치
await page.goto(APP);
await page.waitForSelector('.empty');
await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 8000 }).catch(() => {});
await page.reload(); await page.waitForSelector('.empty');
ok(await page.evaluate(() => navigator.serviceWorker.controller !== null), '서비스 워커가 페이지를 제어함');
const v1 = await page.evaluate(async () => (await (await fetch('sw.js')).text()).match(/const VERSION = '([0-9a-f]+)'/)[1]);
console.log('  버전', v1);
const keys = await page.evaluate(() => caches.keys());
ok(keys.some((k) => k === `gagyeboo-app-${v1}`), '앱 파일 저장소 생성 ' + keys.join(','));
ok(!(await page.locator('.update-banner').count()), '처음 설치 때는 새 버전 안내가 뜨지 않음');

// 데이터 입력
await page.getByText('가상 데이터로 둘러보기').first().click();
await page.waitForSelector('.ledger'); await page.waitForTimeout(500);
if (await page.locator('.modal.is-wide').count()) { await page.keyboard.press('Escape'); await page.waitForTimeout(200); }
const total1 = (await page.locator('.stat-total .stat-value').innerText()).replace(/[^\d]/g, '');

// 오프라인
await ctx.setOffline(true);
await page.reload(); await page.waitForSelector('.ledger', { timeout: 10000 });
if (await page.locator('.modal.is-wide').count()) { await page.keyboard.press('Escape'); await page.waitForTimeout(200); }
ok(true, '인터넷 없이 새로고침해도 앱이 열림');
ok((await page.locator('.stat-total .stat-value').innerText()).replace(/[^\d]/g, '') === total1, '오프라인에서도 데이터 그대로');
await page.locator('.add-btn').click(); await page.waitForSelector('.sheet');
await page.fill('#f-store', '오프라인 입력'); await page.fill('#f-amount', '1234');
await page.locator('.sheet-foot .btn.primary').click(); await page.waitForTimeout(500);
ok((await page.locator('.ledger', { hasText: '오프라인 입력' }).count()) === 1, '오프라인에서 입력·저장');
const r404 = await page.evaluate(() => fetch('about.html').then((r) => r.ok).catch(() => false));
ok(r404, '안내 페이지(about.html)도 오프라인에서 열림');
await page.locator('.tab', { hasText: '설정' }).click(); await page.waitForTimeout(200);
await page.locator('.side-item', { hasText: '앱 정보' }).click();
ok((await page.locator('.card-block', { hasText: '앱으로 설치' }).count()) === 1, '앱 정보에 설치·오프라인 안내');
await ctx.setOffline(false);

// 새 버전: 코드를 한 줄 바꿔 다시 빌드 → 버전이 달라져야 함
const marker = 'src/main.tsx';
const orig = fs.readFileSync(marker, 'utf8');
fs.writeFileSync(marker, orig + '\nconsole.debug("pwa-test-' + Date.now() + '");\n');
const b = spawnSync('npx', ['vite', 'build'], { encoding: 'utf8' });
fs.writeFileSync(marker, orig);
if (b.status !== 0) { console.log(b.stdout, b.stderr); process.exit(1); }
const v2 = (fs.readFileSync('dist/sw.js', 'utf8').match(/const VERSION = '([0-9a-f]+)'/) || [])[1];
ok(v2 && v2 !== v1, `다시 빌드하면 버전이 바뀜 (${v1} → ${v2})`);

await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r.update()));
await page.waitForSelector('.update-banner', { timeout: 10000 });
ok(true, '새 버전을 받아 두면 화면 위에 안내가 뜸');
ok((await page.locator('.update-banner').innerText()).includes('새로고침'), '안내 문구에 새로고침');
await page.locator('.tab', { hasText: '내역' }).click(); await page.waitForTimeout(300);
// 안내가 뜬 동안에도 지금 화면은 이전 버전 그대로 동작
ok((await page.locator('.ledger', { hasText: '오프라인 입력' }).count()) === 1, '안내만 뜨고 화면은 그대로');
await Promise.all([page.waitForEvent('load'), page.locator('.update-banner .btn').click()]);
await page.waitForSelector('.ledger'); await page.waitForTimeout(600);
if (await page.locator('.modal.is-wide').count()) { await page.keyboard.press('Escape'); await page.waitForTimeout(200); }
const v2live = await page.evaluate(async () => (await (await fetch('sw.js')).text()).match(/const VERSION = '([0-9a-f]+)'/)[1]);
const keys2 = await page.evaluate(() => caches.keys());
ok(keys2.includes(`gagyeboo-app-${v2live}`) && !keys2.includes(`gagyeboo-app-${v1}`), '새로고침 후 새 저장소만 남고 옛 저장소는 지워짐 ' + keys2.join(','));
ok((await page.locator('.ledger', { hasText: '오프라인 입력' }).count()) === 1, '업데이트 뒤에도 입력한 데이터 그대로');
ok(!(await page.locator('.update-banner').count()), '새로고침 후 안내가 사라짐');
// 오프라인 동안 실패한 요청은 다른 사이트(구글 로그인 스크립트 등)뿐이어야 한다
// (글꼴 조각은 쓸 때 저장하므로, 오프라인에서 처음 쓰는 글자의 조각은 받지 못하고 시스템 글꼴로 대신 표시된다)
const own = failedReqs.filter((u) => u.startsWith(`http://localhost:${PORT}`) && !/\.woff2?$/.test(u));
console.log('  실패한 요청 수(글꼴 조각 포함):', failedReqs.length);
ok(own.length === 0, '이 사이트의 파일은 오프라인에서도 모두 받아짐 ' + own.join(','));
const other = errs.filter((e) => !/ERR_FAILED|ERR_INTERNET_DISCONNECTED/.test(e));
ok(other.length === 0, '앱 오류 없음 ' + other.join(' | ').slice(0, 300));

await browser.close();
server.close();
console.log(failed ? `\n${failed}건 실패` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
