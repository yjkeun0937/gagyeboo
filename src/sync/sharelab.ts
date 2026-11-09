/**
 * 계정 공유 시험용(2단계 시제품). 실제 앱의 로그인·동기화와 완전히 분리되어 있으며,
 * 주소 끝에 #share-lab 을 붙여 열었을 때만 쓰인다. 토큰은 메모리에만 두고 저장하지 않는다.
 * 목적: 드라이브 권한 범위(drive.file / drive)에서 공유 폴더 읽기·쓰기·삭제가 실제로 어떻게 동작하는지 확인.
 */
export type LabScope = 'drive.file' | 'drive';

export * from './driveapi';
export type { LabCall } from './driveapi';

interface TokenResp {
  access_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}
interface GisOauth {
  initTokenClient(cfg: {
    client_id: string;
    scope: string;
    /** false면 이전에 허용한 범위를 이번 토큰에 합치지 않는다 (기본값은 true) */
    include_granted_scopes?: boolean;
    callback: (r: TokenResp) => void;
    error_callback?: (e: { type?: string; message?: string }) => void;
  }): { requestAccessToken(o?: { prompt?: string }): void };
}
const g = () => (window as unknown as { google?: { accounts: { oauth2: GisOauth } } }).google;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`스크립트를 불러오지 못했습니다: ${src}`));
    document.head.appendChild(s);
  });
}

export interface LabSession {
  token: string;
  email: string;
  grantedScope: string;
  /** 요청한 드라이브 범위가 실제로 허용되었는가 (콘솔의 데이터 액세스에 저장되어 있지 않으면 false) */
  scopeOk: boolean;
  /** 요청한 것보다 넓은 드라이브 범위(drive)가 섞였는가. drive.file 시험에서는 결과가 무효가 된다 */
  tooBroad: boolean;
}

/** 지정한 범위로 로그인한다. 사용자가 누른 직후에 호출해야 팝업이 막히지 않는다 */
export async function labSignIn(clientId: string, scope: LabScope, forceConsent = true): Promise<LabSession> {
  await loadScript('https://accounts.google.com/gsi/client');
  const oauth = g()?.accounts.oauth2;
  if (!oauth) throw new Error('구글 로그인 스크립트가 준비되지 않았습니다');
  const res = await new Promise<TokenResp>((resolve, reject) => {
    const client = oauth.initTokenClient({
      client_id: clientId,
      scope: `openid email profile https://www.googleapis.com/auth/${scope}`,
      include_granted_scopes: false,
      callback: (r) => (r.error || !r.access_token ? reject(new Error(r.error_description || r.error || '로그인 실패')) : resolve(r)),
      error_callback: (e) => reject(new Error(e.message || e.type || '로그인 창이 닫혔습니다')),
    });
    client.requestAccessToken({ prompt: forceConsent ? 'select_account consent' : 'select_account' });
  });
  const token = res.access_token!;
  const u = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${token}` } });
  const info = (await u.json()) as { email?: string };
  const granted = res.scope ?? '';
  return {
    token,
    email: info.email ?? '(이메일 없음)',
    grantedScope: granted,
    scopeOk: granted.split(/\s+/).includes(`https://www.googleapis.com/auth/${scope}`),
    tooBroad: scope === 'drive.file' && granted.split(/\s+/).includes('https://www.googleapis.com/auth/drive'),
  };
}

/** 구글 파일 선택 창(Picker)으로 폴더(또는 파일)를 고른다. 선택한 항목은 drive.file 범위에서도 접근할 수 있게 된다 */
export async function pick(
  token: string,
  apiKey: string,
  appId: string,
  kind: 'folder' | 'file',
  /** 내가 소유하지 않은 항목만 보이게 할지 (공유받은 것을 고를 때). false면 모두 보임 */
  sharedOnly = true,
): Promise<{ id: string; name: string } | null> {
  await loadScript('https://apis.google.com/js/api.js');
  const gapi = (window as unknown as { gapi: { load(n: string, cb: () => void): void } }).gapi;
  await new Promise<void>((r) => gapi.load('picker', () => r()));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const gp = (window as any).google.picker;
  return new Promise((resolve) => {
    const view = new gp.DocsView(kind === 'folder' ? gp.ViewId.FOLDERS : gp.ViewId.DOCS)
      .setIncludeFolders(true)
      .setSelectFolderEnabled(kind === 'folder');
    if (sharedOnly) view.setOwnedByMe(false);
    const builder = new gp.PickerBuilder()
      .addView(view)
      .setOAuthToken(token)
      .setDeveloperKey(apiKey)
      .setCallback((d: { action: string; docs?: { id: string; name: string }[] }) => {
        if (d.action === gp.Action.PICKED && d.docs?.[0]) resolve({ id: d.docs[0].id, name: d.docs[0].name });
        else if (d.action === gp.Action.CANCEL) resolve(null);
      });
    if (appId) builder.setAppId(appId);
    builder.build().setVisible(true);
  });
}
