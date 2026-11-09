// 구글 로그인 스크립트와 드라이브 REST를 가짜로 대신하는 서버 (Playwright route).
// 여러 브라우저 컨텍스트(=여러 기기)가 같은 가짜 드라이브를 공유한다.
export class FakeGoogle {
  drives = new Map(); // sub -> Map(id -> {name, content, version})
  seq = 0;
  expired = false; // true면 드라이브 요청에 401
  offline = false; // true면 구글에 닿지 못함(네트워크 오류)
  log = [];
  gfiles = new Map(); // 공유용 파일·폴더(앱 전용 폴더 밖): id -> {id,name,mimeType,parents,owner,content,perms,trashed}
  picked = new Set(); // 'who:fileId' — 손님이 파일 선택 창으로 고른 파일
  fullScope = true; // false면 드라이브 전체 범위가 허용되지 않은 것처럼 동작
  accounts = {
    alice: { sub: 'sub-alice', name: '앨리스', email: 'alice@example.com' },
    bob: { sub: 'sub-bob', name: '밥', email: 'bob@example.com' },
  };

  drive(sub) {
    if (!this.drives.has(sub)) this.drives.set(sub, new Map());
    return this.drives.get(sub);
  }
  files(who = 'alice') {
    return [...this.drive(this.accounts[who].sub).values()];
  }
  json(name, who = 'alice') {
    const f = this.files(who).find((x) => x.name === name);
    return f ? JSON.parse(f.content) : null;
  }

  async install(context) {
    await context.route('https://accounts.google.com/gsi/client', (route) =>
      route.fulfill({
        contentType: 'text/javascript',
        body: `
          window.google = window.google || {}; window.google.accounts = { oauth2: {
            initTokenClient(cfg) {
              return { requestAccessToken(o) {
                const mode = window.__FAKE_MODE || 'ok';
                if (mode === 'closed') return cfg.error_callback({ type: 'popup_closed' });
                const who = window.__FAKE_ACCOUNT || localStorage.getItem('fakeAccount') || 'alice';
                let scope = mode === 'noscope' ? 'openid email profile' : cfg.scope;
                if (window.__FAKE_NOFULL) scope = scope.split(' ').filter((x) => x !== 'https://www.googleapis.com/auth/drive').join(' ');
                const full = scope.split(' ').includes('https://www.googleapis.com/auth/drive');
                window.__LAST_PROMPT = o && o.prompt; window.__LAST_HINT = o && o.hint;
                window.__LAST_SCOPE = cfg.scope; window.__LAST_INCLUDE = cfg.include_granted_scopes;
                window.__TOKEN_REQUESTS = (window.__TOKEN_REQUESTS || 0) + 1;
                cfg.callback({ access_token: 'tok-' + who + (full ? '+full' : ''), expires_in: 3600, scope });
              } };
            },
            revoke(t, done) { window.__REVOKED = t; done && done(); }
          } };`,
      }),
    );
    await context.route('https://apis.google.com/js/api.js', (route) =>
      route.fulfill({
        contentType: 'text/javascript',
        body: `
          window.gapi = { load(n, cb) { cb(); } };
          window.google = window.google || {};
          window.google.picker = {
            ViewId: { DOCS: 'docs' }, Action: { PICKED: 'picked', CANCEL: 'cancel' },
            DocsView: function () { this.setIncludeFolders = () => this; this.setOwnedByMe = () => this; },
            PickerBuilder: function () {
              let cb; let tok = '';
              this.addView = () => this; this.setDeveloperKey = () => this; this.setAppId = () => this;
              this.setOAuthToken = (t) => { tok = t; return this; };
              this.setCallback = (f) => { cb = f; return this; };
              this.build = () => ({ setVisible() {
                setTimeout(async () => {
                  const p = window.__PICK;
                  if (!p) return cb({ action: 'cancel' });
                  await fetch('https://www.googleapis.com/__fake/pick?id=' + encodeURIComponent(p.id), { headers: { authorization: 'Bearer ' + tok } });
                  cb({ action: 'picked', docs: [{ id: p.id, name: p.name }] });
                }, 10);
              } });
            },
          };`,
      }),
    );
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    await context.route(/https:\/\/www\.googleapis\.com\/.*/, async (route) => {
      const req = route.request();
      if (this.offline) return route.abort('connectionfailed');
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      const url = new URL(req.url());
      const auth = req.headers()['authorization'] || '';
      const tok = auth.replace('Bearer tok-', '').split('+');
      const who = tok[0];
      const full = tok.includes('full');
      const acct = this.accounts[who];
      const json = (status, body) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (!acct || this.expired) return json(401, { error: { code: 401, message: 'Invalid Credentials' } });
      this.log.push(`${req.method()} ${url.pathname}${url.search ? '?' + url.searchParams.get('uploadType') || url.searchParams.get('alt') || '' : ''}`);
      if (url.pathname === '/oauth2/v3/userinfo') return json(200, { sub: acct.sub, name: acct.name, email: acct.email });
      if (url.pathname === '/__fake/pick') {
        this.picked.add(who + ':' + url.searchParams.get('id'));
        return json(200, {});
      }
      const d = this.drive(acct.sub);
      // ── 공유용(앱 전용 폴더 밖) 파일·폴더·권한: 드라이브 전체 범위가 있어야 한다
      const sm = url.pathname.match(/\/(?:upload\/)?drive\/v3\/files(?:\/([^/]+))?(?:\/permissions(?:\/([^/]+))?)?$/);
      const isPerm = /\/permissions/.test(url.pathname);
      const sid = sm?.[1];
      const body0 = req.postData() || '';
      const isUploadCreate = req.method() === 'POST' && url.pathname.startsWith('/upload/');
      const sharedCall =
        isPerm ||
        (sid && this.gfiles.has(sid)) ||
        (req.method() === 'POST' && !sid && !url.pathname.startsWith('/upload/')) ||
        (isUploadCreate && !/appDataFolder/.test(body0));
      if (sharedCall) {
        const notFound = () => json(404, { error: { code: 404, message: 'File not found', errors: [{ reason: 'notFound' }] } });
        const roleOn = (f, email) => {
          for (let x = f; x; x = this.gfiles.get(x.parents?.[0])) {
            if (x.owner === email) return 'owner';
            const p = x.perms.find((q) => q.emailAddress === email);
            if (p) return p.role;
          }
          return null;
        };
        if (!full) {
          // drive.file 범위: 내가 만들었거나 파일 선택 창으로 고른 파일만 다룰 수 있다
          const insufficient = () => json(403, { error: { code: 403, message: 'insufficient scope', errors: [{ reason: 'insufficientPermissions' }] } });
          if (isPerm) return insufficient();
          if (isUploadCreate) {
            const bd = (req.headers()['content-type'] || '').match(/boundary=(.+)$/)[1];
            const m0 = JSON.parse(body0.split('--' + bd).filter((q) => q.trim() && q.trim() !== '--')[0].split('\r\n\r\n')[1].trim());
            const parent = this.gfiles.get(m0.parents?.[0]);
            const role = parent ? roleOn(parent, acct.email) : null;
            if (role !== 'owner' && role !== 'writer') return notFound();
          } else if (req.method() === 'POST' && !sid) {
            return insufficient();
          } else {
            const f0 = this.gfiles.get(sid);
            const role = f0 ? roleOn(f0, acct.email) : null;
            const mine = f0 && (f0.owner === acct.email || this.picked.has(who + ':' + sid));
            if (!f0 || !role || !mine) return notFound();
            if (!['GET', 'DELETE'].includes(req.method())) return insufficient();
            if (req.method() === 'DELETE' && f0.owner !== acct.email) return insufficient();
          }
        }
        const gf = (x) => ({ id: x.id, name: x.name, mimeType: x.mimeType, trashed: x.trashed, modifiedTime: new Date(1.7e12 + (x.writes || 0) * 1000).toISOString() });
        if (isPerm) {
          const f = this.gfiles.get(sid);
          if (!f) return json(404, { error: { message: 'File not found: ' + sid } });
          const pid = sm?.[2];
          if (req.method() === 'POST') {
            const b = JSON.parse(body0);
            if (!/@gmail\.com$|@example\.com$/.test(b.emailAddress)) return json(400, { error: { code: 400, message: 'Invalid value for emailAddress' } });
            const p = { id: 'perm' + ++this.seq, role: b.role, emailAddress: b.emailAddress };
            f.perms.push(p);
            return json(200, p);
          }
          if (req.method() === 'GET') return json(200, { permissions: [{ id: 'own', role: 'owner', emailAddress: f.owner }, ...f.perms] });
          if (req.method() === 'DELETE') {
            f.perms = f.perms.filter((p) => p.id !== pid);
            return route.fulfill({ status: 204, headers: cors });
          }
        }
        if (isUploadCreate) {
          const boundary = (req.headers()['content-type'] || '').match(/boundary=(.+)$/)[1];
          const parts = body0.split(`--${boundary}`).filter((p) => p.trim() && p.trim() !== '--');
          const meta = JSON.parse(parts[0].split('\r\n\r\n')[1].trim());
          const content = parts[1].split('\r\n\r\n').slice(1).join('\r\n\r\n').replace(/\r\n$/, '');
          const x = { id: 'g' + ++this.seq, name: meta.name, mimeType: meta.mimeType, parents: meta.parents, owner: acct.email, content, perms: [], trashed: false, writes: 1 };
          this.gfiles.set(x.id, x);
          return json(200, gf(x));
        }
        if (req.method() === 'POST' && !sid) {
          const meta = JSON.parse(body0);
          const x = { id: 'g' + ++this.seq, name: meta.name, mimeType: meta.mimeType, parents: meta.parents || [], owner: acct.email, content: '', perms: [], trashed: false };
          this.gfiles.set(x.id, x);
          return json(200, gf(x));
        }
        const f = this.gfiles.get(sid);
        if (!f) return json(404, { error: { message: 'File not found: ' + sid } });
        if (req.method() === 'DELETE') {
          this.gfiles.delete(sid);
          return route.fulfill({ status: 204, headers: cors });
        }
        if (req.method() === 'PATCH' && url.pathname.startsWith('/upload/')) {
          f.content = body0;
          f.writes = (f.writes || 0) + 1;
          return json(200, gf(f));
        }
        if (req.method() === 'PATCH') {
          const b = JSON.parse(body0 || '{}');
          if ('trashed' in b) f.trashed = !!b.trashed;
          return json(200, gf(f));
        }
        if (req.method() === 'GET') {
          if (url.searchParams.get('alt') === 'media') return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: f.content });
          return json(200, gf(f));
        }
      }
      const info = (id) => ({ id, name: d.get(id).name, version: String(d.get(id).version) });
      const m = url.pathname.match(/\/(?:upload\/)?drive\/v3\/files(?:\/([^/]+))?$/);
      if (!m) return json(404, { error: { message: 'unknown ' + url.pathname } });
      const id = m[1];
      if (req.method() === 'GET' && !id) return json(200, { files: [...d.keys()].map(info) });
      if (req.method() === 'GET' && id) {
        if (!d.has(id)) return json(404, { error: { message: 'not found' } });
        if (url.searchParams.get('alt') === 'media') return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: d.get(id).content });
        return json(200, info(id));
      }
      if (req.method() === 'DELETE') {
        d.delete(id);
        return route.fulfill({ status: 204, headers: cors });
      }
      if (req.method() === 'POST' && url.pathname.startsWith('/upload/')) {
        const body = req.postData() || '';
        const boundary = (req.headers()['content-type'] || '').match(/boundary=(.+)$/)[1];
        const parts = body.split(`--${boundary}`).filter((p) => p.trim() && p.trim() !== '--');
        const meta = JSON.parse(parts[0].split('\r\n\r\n')[1].trim());
        const content = parts[1].split('\r\n\r\n').slice(1).join('\r\n\r\n').replace(/\r\n$/, '');
        if (!meta.parents?.includes('appDataFolder')) return json(400, { error: { message: 'parents' } });
        const nid = `file${String(++this.seq).padStart(3, '0')}`;
        d.set(nid, { name: meta.name, content, version: 1 });
        return json(200, info(nid));
      }
      if (req.method() === 'PATCH' && id) {
        if (!d.has(id)) return json(404, { error: { message: 'not found' } });
        const f = d.get(id);
        f.content = req.postData() || '';
        f.version++;
        return json(200, info(id));
      }
      return json(400, { error: { message: 'unsupported' } });
    });
  }
}
