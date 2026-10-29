// 구글 로그인 스크립트와 드라이브 REST를 가짜로 대신하는 서버 (Playwright route).
// 여러 브라우저 컨텍스트(=여러 기기)가 같은 가짜 드라이브를 공유한다.
export class FakeGoogle {
  drives = new Map(); // sub -> Map(id -> {name, content, version})
  seq = 0;
  expired = false; // true면 드라이브 요청에 401
  offline = false; // true면 구글에 닿지 못함(네트워크 오류)
  log = [];
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
          window.google = { accounts: { oauth2: {
            initTokenClient(cfg) {
              return { requestAccessToken(o) {
                const mode = window.__FAKE_MODE || 'ok';
                if (mode === 'closed') return cfg.error_callback({ type: 'popup_closed' });
                const who = window.__FAKE_ACCOUNT || localStorage.getItem('fakeAccount') || 'alice';
                const scope = mode === 'noscope' ? 'openid email profile' : 'openid email profile https://www.googleapis.com/auth/drive.appdata';
                window.__LAST_PROMPT = o && o.prompt; window.__LAST_HINT = o && o.hint;
                cfg.callback({ access_token: 'tok-' + who, expires_in: 3600, scope });
              } };
            },
            revoke(t, done) { window.__REVOKED = t; done && done(); }
          } } };`,
      }),
    );
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    await context.route(/https:\/\/www\.googleapis\.com\/.*/, async (route) => {
      const req = route.request();
      if (this.offline) return route.abort('connectionfailed');
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      const url = new URL(req.url());
      const auth = req.headers()['authorization'] || '';
      const who = auth.replace('Bearer tok-', '');
      const acct = this.accounts[who];
      const json = (status, body) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (!acct || this.expired) return json(401, { error: { code: 401, message: 'Invalid Credentials' } });
      this.log.push(`${req.method()} ${url.pathname}${url.search ? '?' + url.searchParams.get('uploadType') || url.searchParams.get('alt') || '' : ''}`);
      if (url.pathname === '/oauth2/v3/userinfo') return json(200, { sub: acct.sub, name: acct.name, email: acct.email });
      const d = this.drive(acct.sub);
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
